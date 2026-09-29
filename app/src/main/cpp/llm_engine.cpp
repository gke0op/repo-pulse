#include "llm_engine.h"

#include <algorithm>
#include <chrono>
#include <memory>
#include <thread>

#include "common.h"
#include "sampling.h"

namespace {

double now_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

// Length of the longest prefix of s that ends on a complete UTF-8 code point.
size_t utf8_complete_prefix(const std::string & s) {
    if (s.empty()) return 0;
    size_t i = s.size() - 1;
    int back = 0;
    while (i > 0 && back < 3 && (static_cast<unsigned char>(s[i]) & 0xC0) == 0x80) { --i; ++back; }
    const unsigned char lead = static_cast<unsigned char>(s[i]);
    size_t need = 1;
    if      ((lead & 0xE0) == 0xC0) need = 2;
    else if ((lead & 0xF0) == 0xE0) need = 3;
    else if ((lead & 0xF8) == 0xF0) need = 4;
    return (s.size() - i >= need) ? s.size() : i;
}

} // namespace

LlmEngine::~LlmEngine() { unload(); }

bool LlmEngine::load(const std::string & path, int n_ctx, int n_threads, int n_threads_batch) {
    unload();

    llama_model_params mp = llama_model_default_params();
    mp.load_mode = LLAMA_LOAD_MODE_MMAP; // weights stay file-backed: the OS can page them instead of OOM-killing us
    model_ = llama_model_load_from_file(path.c_str(), mp);
    if (!model_) return false;

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = n_ctx;
    cp.n_batch         = n_batch_;
    cp.n_ubatch        = n_batch_;
    cp.n_threads       = n_threads;
    cp.n_threads_batch = n_threads_batch > 0 ? n_threads_batch : n_threads;
    ctx_ = llama_init_from_model(model_, cp);
    if (!ctx_) { unload(); return false; }
    n_ctx_ = (int) llama_n_ctx(ctx_);

    batch_     = llama_batch_init(n_batch_, 0, 1);
    templates_ = common_chat_templates_init(model_, "");

    common_params_sampling sp;
    sp.temp           = 0.8f;
    sp.top_p          = 0.95f;
    sp.min_p          = 0.05f;
    sp.penalty_repeat = 1.1f;
    sampler_ = common_sampler_init(model_, sp);
    return sampler_ != nullptr;
}

void LlmEngine::unload() {
    last_reply_stored_ = false;
    if (sampler_) { common_sampler_free(sampler_); sampler_ = nullptr; }
    templates_.reset();
    if (batch_.token) { llama_batch_free(batch_); batch_ = {}; }
    if (ctx_)   { llama_free(ctx_); ctx_ = nullptr; }
    if (model_) { llama_model_free(model_); model_ = nullptr; }
    msgs_.clear();
    kv_tokens_.clear();
}

// Everything up to where the first user message's text will go. Rendering the system message
// alone isn't enough: templates without a system role (Gemma) fold it into the first user turn,
// so that render never matches the real prompt and the whole system prompt was re-decoded on the
// first reply (measured: 276 tokens, 6.5 s on the phone).
std::vector<llama_token> LlmEngine::system_head(const std::string & system_prompt) const {
    static const std::string MARK = "\x01\x02USER\x02\x01";
    common_chat_msg sys, probe;
    sys.role      = "system"; sys.content = system_prompt;
    probe.role    = "user";   probe.content = MARK;
    const std::string full = render_text({sys, probe}, true);
    const size_t at = full.find(MARK);
    const std::string head = at == std::string::npos ? render_text({sys}, false) : full.substr(0, at);
    return common_tokenize(ctx_, head, /*add_special*/ true, /*parse_special*/ true);
}

// Saves seq 0 of [ctx]; a failed save (disk full) must not leave a partial file behind (review 2026-09-29).
static bool save_state(llama_context * ctx, const std::string & path, const std::vector<llama_token> & tokens) {
    if (llama_state_seq_save_file(ctx, path.c_str(), 0, tokens.data(), tokens.size()) > 0) return true;
    std::remove(path.c_str());
    return false;
}

bool LlmEngine::prime_cache_isolated(const std::string & system_prompt, const std::string & cache_path, unsigned gen0) {
    if (!model_ || !ctx_) return false;
    const unsigned pgen0 = prime_cancel_gen_.load();
    auto cancelled = [&] { return cancel_gen_.load() != gen0 || prime_cancel_gen_.load() != pgen0; };
    const auto tokens = system_head(system_prompt);
    if ((int) tokens.size() >= n_ctx_) return false;
    // Only as big as the prompt, SWA layers window-sized: the saved state holds just these cells
    // (masked SWA cells are never saved), so it loads into the live context all the same, at about
    // a third of the RAM of a full-size scratch context (review 2026-09-29; kvcache_test checks it).
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = (uint32_t) ((tokens.size() + 1 + 255) / 256 * 256);
    cp.n_batch         = 64;       // small batches: cancel() takes effect quickly
    cp.n_ubatch        = 64;
    cp.n_threads       = llama_n_threads(ctx_);
    cp.n_threads_batch = llama_n_threads_batch(ctx_);
    cp.swa_full        = false;
    if (cancelled()) return false;
    std::unique_ptr<llama_context, decltype(&llama_free)> scratch(llama_init_from_model(model_, cp), &llama_free);
    if (!scratch) return false;
    std::unique_ptr<llama_batch, void (*)(llama_batch *)> b(new llama_batch(llama_batch_init(64, 0, 1)),
        [](llama_batch * p) { llama_batch_free(*p); delete p; });
    for (size_t i = 0; i < tokens.size(); i += 64) {
        if (cancelled()) return false;
        const size_t n = std::min((size_t) 64, tokens.size() - i);
        common_batch_clear(*b);
        for (size_t j = 0; j < n; ++j) common_batch_add(*b, tokens[i + j], (llama_pos) (i + j), {0}, i + j == tokens.size() - 1);
        if (llama_decode(scratch.get(), *b) != 0) return false;
    }
    if (cancelled()) return false;
    return save_state(scratch.get(), cache_path, tokens);
}

bool LlmEngine::set_system(const std::string & system_prompt, const std::string & cache_path) {
    if (!ctx_) return false;
    msgs_.clear();
    last_reply_stored_ = false;
    common_chat_msg sys;
    sys.role    = "system";
    sys.content = system_prompt;
    msgs_.push_back(sys);
    const auto tokens = system_head(system_prompt);
    last_prime_ms_ = 0; last_prime_cached_ = false; last_prime_file_ok_ = false;
    const double t0 = now_ms();
    // Already primed with exactly this prompt (the same character again): nothing to read or save.
    if (kv_tokens_ == tokens) { last_prime_cached_ = last_prime_file_ok_ = !cache_path.empty(); return true; }

    // Reading a ~750-1,400-token system prompt took ~18 s at every launch (phone 2026-09-29). With a
    // cache file, the primed KV state is loaded instead: used only if it holds exactly these tokens
    // (the file name must also carry the model and n_ctx), otherwise primed as usual and saved.
    if (!cache_path.empty()) {
        std::vector<llama_token> got(tokens.size() + 1);
        size_t n = 0;
        llama_memory_seq_rm(llama_get_memory(ctx_), 0, -1, -1);
        kv_tokens_.clear();
        if (llama_state_seq_load_file(ctx_, cache_path.c_str(), 0, got.data(), got.size(), &n) > 0 &&
            n == tokens.size() && std::equal(tokens.begin(), tokens.end(), got.begin())) {
            kv_tokens_ = tokens;
            last_prime_cached_ = last_prime_file_ok_ = true;
            last_prime_ms_ = now_ms() - t0;
            return true;
        }
        llama_memory_seq_rm(llama_get_memory(ctx_), 0, -1, -1); // a partial or stale load
    }
    LlmTurnStats ignored;
    const bool ok = sync_kv(tokens, ignored);
    if (ok && !cache_path.empty()) last_prime_file_ok_ = save_state(ctx_, cache_path, tokens);
    last_prime_ms_ = now_ms() - t0;
    return ok;
}

std::string LlmEngine::render_text(const std::vector<common_chat_msg> & msgs, bool add_generation_prompt) const {
    common_chat_templates_inputs in;
    in.messages              = msgs;
    in.add_generation_prompt = add_generation_prompt;
    in.use_jinja             = true;
    // llama.cpp defaults this to true, which puts Gemma 4's <|think|> switch in every prompt: memory
    // distillation then spent its whole budget in a thought channel and the notes it restated there
    // were parsed as new ones (phone 2026-09-29). Replies only escaped it through the "[" prefill.
    in.enable_thinking       = false;
    return common_chat_templates_apply(templates_.get(), in).prompt;
}

std::vector<llama_token> LlmEngine::render(bool add_generation_prompt) const {
    return common_tokenize(ctx_, render_text(msgs_, add_generation_prompt), /*add_special*/ true, /*parse_special*/ true);
}

// Make the KV cache hold exactly `prompt`, reusing the longest shared prefix.
bool LlmEngine::sync_kv(const std::vector<llama_token> & prompt, LlmTurnStats & stats) {
    size_t keep = 0;
    while (keep < kv_tokens_.size() && keep < prompt.size() && kv_tokens_[keep] == prompt[keep]) ++keep;
    // Always re-decode at least the last token so we have fresh logits to sample from.
    if (keep == prompt.size() && keep > 0) --keep;

    // Recurrent and hybrid models (LFM2) can't drop a tail of their state: seq_rm refuses, and
    // decoding on top of the stale state produced empty replies from the second turn on
    // (littleself race, 2026-09-29). Start clean then: slower for them, never wrong.
    if (!llama_memory_seq_rm(llama_get_memory(ctx_), 0, (llama_pos) keep, -1)) {
        llama_memory_seq_rm(llama_get_memory(ctx_), 0, -1, -1);
        keep = 0;
    }
    kv_tokens_.resize(keep);

    const double t0 = now_ms();
    const bool ok = decode_from(prompt, keep);
    stats.prompt_tokens = (int) (prompt.size() - keep);
    stats.prefill_ms    = now_ms() - t0;
    return ok;
}

// After a history trim the cache still holds the dropped exchanges between the system prefix
// and the kept history. Cut them out and slide the kept part down instead of re-decoding it all
// (measured on the phone: 849 tokens, 39.7 s). Needs a shiftable cache; Gemma's SWA cache is
// (swa_full is on by default). Returns how many cached tokens were kept by the shift.
size_t LlmEngine::shift_out_dropped(const std::vector<llama_token> & prompt) {
    llama_memory_t mem = llama_get_memory(ctx_);
    if (!llama_memory_can_shift(mem)) return 0;
    size_t a = 0;
    while (a < kv_tokens_.size() && a < prompt.size() && kv_tokens_[a] == prompt[a]) ++a;
    // Where does prompt[a..] (the kept history) continue inside the cache?
    size_t best_b = 0, best_len = 0;
    for (size_t b = a + 1; b < kv_tokens_.size(); ++b) {
        size_t n = 0;
        while (b + n < kv_tokens_.size() && a + n < prompt.size() && kv_tokens_[b + n] == prompt[a + n]) ++n;
        if (n > best_len) { best_len = n; best_b = b; }
    }
    if (best_len < 32) return 0; // short runs are template boilerplate, not the kept history
    if (!llama_memory_seq_rm(mem, 0, (llama_pos) a, (llama_pos) best_b)) return 0;
    llama_memory_seq_add(mem, 0, (llama_pos) best_b, -1, -(llama_pos) (best_b - a));
    kv_tokens_.erase(kv_tokens_.begin() + a, kv_tokens_.begin() + best_b);
    return best_len;
}

bool LlmEngine::decode_from(const std::vector<llama_token> & tokens, size_t start) {
    for (size_t i = start; i < tokens.size(); i += n_batch_) {
        const size_t n = std::min((size_t) n_batch_, tokens.size() - i);
        common_batch_clear(batch_);
        for (size_t j = 0; j < n; ++j) {
            const bool last = (i + j == tokens.size() - 1);
            common_batch_add(batch_, tokens[i + j], (llama_pos) (i + j), {0}, last);
        }
        if (llama_decode(ctx_, batch_) != 0) return false;
        kv_tokens_.insert(kv_tokens_.end(), tokens.begin() + i, tokens.begin() + i + n);
    }
    return true;
}

std::string LlmEngine::reply(const std::string & user_text, int max_tokens,
                             const PieceFn & on_piece, LlmTurnStats & stats,
                             const std::string & prefix) {
    stats = {};
    const unsigned gen0 = cancel_gen_.load();
    auto cancelled = [&] { return cancel_gen_.load() != gen0; };
    hold_.store(false);
    last_reply_stored_ = false;
    stats.reply_id = ++reply_id_;
    undo_valid_ = false;
    if (!ctx_ || msgs_.empty()) return "";

    // A turn that got no reply leaves its user message last. Fold the new text into it: roles
    // must alternate (Gemma's template throws otherwise) and the brain hears one whole message.
    undo_valid_ = true;
    if (msgs_.back().role == "user") {
        undo_pushed_ = false;
        undo_prev_content_ = msgs_.back().content;
        msgs_.back().content += " " + user_text;
    } else {
        undo_pushed_ = true;
        common_chat_msg user;
        user.role    = "user";
        user.content = user_text;
        msgs_.push_back(user);
    }

    // On overflow, trim the oldest exchanges (never the system prompt) until half of the room
    // history can have is free again; shift_out_dropped then reuses the kept history instead of
    // re-decoding it. (A fixed 3/4-of-context target sat below Unit Seven's ~1,400-token system
    // prompt, so every trim dropped the whole conversation: phone 2026-09-29.)
    auto prompt = render(true);
    const bool overflow = (int) prompt.size() + max_tokens > n_ctx_;
    int target = n_ctx_ * 3 / 4;
    if (overflow) {
        const int base = (int) common_tokenize(ctx_, render_text({msgs_.front(), msgs_.back()}, true), true, true).size();
        target = base + max_tokens + (n_ctx_ - max_tokens - base) / 2;
    }
    while (overflow && (int) prompt.size() + max_tokens > target && msgs_.size() > 2) {
        // Drop the oldest exchange, then anything up to the next user turn.
        msgs_.erase(msgs_.begin() + 1);
        while (msgs_.size() > 2 && msgs_[1].role != "user") msgs_.erase(msgs_.begin() + 1);
        stats.rebuilt = true;
        prompt = render(true);
    }
    if (!prefix.empty()) {
        const auto pre = common_tokenize(ctx_, prefix, /*add_special*/ false, /*parse_special*/ false);
        prompt.insert(prompt.end(), pre.begin(), pre.end());
    }
    if ((int) prompt.size() >= n_ctx_) return "";
    if (stats.rebuilt) stats.shift_reused = (int) shift_out_dropped(prompt);
    if (!sync_kv(prompt, stats)) return "";

    const llama_vocab * vocab = llama_model_get_vocab(model_);
    common_sampler_reset(sampler_);

    std::string reply_text = prefix, pending;
    if (!prefix.empty() && !on_piece(prefix)) { stats.cancelled = true; }
    const double t0 = now_ms();
    for (int i = 0; i < max_tokens && !stats.cancelled; ++i) {
        // Voice first (see hold()); bounded so a missed release can never stall a reply.
        for (const double h0 = now_ms(); hold_.load() && !cancelled();) {
            if (now_ms() - h0 >= 1500) { hold_.store(false); break; } // the hold expires, not just this wait
            std::this_thread::sleep_for(std::chrono::milliseconds(3));
        }
        if (cancelled()) { stats.cancelled = true; break; }
        if ((int) kv_tokens_.size() >= n_ctx_) break;

        const llama_token tok = common_sampler_sample(sampler_, ctx_, -1);
        common_sampler_accept(sampler_, tok, true);
        if (llama_vocab_is_eog(vocab, tok)) break;

        common_batch_clear(batch_);
        common_batch_add(batch_, tok, (llama_pos) kv_tokens_.size(), {0}, true);
        if (llama_decode(ctx_, batch_) != 0) break;
        kv_tokens_.push_back(tok);
        stats.gen_tokens++;

        pending += common_token_to_piece(ctx_, tok);
        const size_t n = utf8_complete_prefix(pending);
        if (n > 0) {
            const std::string piece = pending.substr(0, n);
            pending.erase(0, n);
            reply_text += piece;
            if (!on_piece(piece)) { stats.cancelled = true; break; }
        }
    }
    stats.gen_ms = now_ms() - t0;
    if (stats.gen_tokens == 0) return reply_text; // nothing was said: the next message joins this one

    common_chat_msg asst;
    asst.role    = "assistant";
    asst.content = reply_text;
    msgs_.push_back(asst);
    last_reply_stored_ = true;
    return reply_text;
}

void LlmEngine::retract_last_reply(long long reply_id, bool drop_user) {
    if (reply_id != reply_id_) return; // a newer reply ran since: nothing of that one is last any more
    if (last_reply_stored_ && msgs_.size() > 1 && msgs_.back().role == "assistant") msgs_.pop_back();
    last_reply_stored_ = false;
    if (drop_user && undo_valid_ && msgs_.size() > 1 && msgs_.back().role == "user") {
        if (undo_pushed_) msgs_.pop_back();
        else msgs_.back().content = undo_prev_content_;
    }
    undo_valid_ = false;
}

bool LlmEngine::complete_isolated(const std::string & system, const std::string & user, int max_tokens, int n_ctx, std::string & out) {
    out.clear();
    if (!model_) return false;
    const unsigned gen0 = cancel_gen_.load();
    auto cancelled = [&] { return cancel_gen_.load() != gen0; };
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = n_ctx;
    cp.n_batch         = 64; // small batches: cancel() takes effect within ~2 s, not a 512-token decode
    cp.n_ubatch        = 64;
    cp.n_threads       = llama_n_threads(ctx_);
    cp.n_threads_batch = llama_n_threads_batch(ctx_);
    cp.swa_full        = false; // never shifted, so the sliding-window layers can keep only their window
    // RAII: a throwing template or tokenizer must not leak the scratch KV cache (review 2026-09-28).
    std::unique_ptr<llama_context, decltype(&llama_free)> scratch(llama_init_from_model(model_, cp), &llama_free);
    if (!scratch) return false;

    common_chat_msg sys, usr;
    sys.role = "system"; sys.content = system;
    usr.role = "user";   usr.content = user;
    const auto prompt = common_tokenize(scratch.get(), render_text({sys, usr}, true), /*add_special*/ true, /*parse_special*/ true);
    if ((int) prompt.size() + max_tokens >= n_ctx) return false;

    std::unique_ptr<llama_batch, void (*)(llama_batch *)> b(new llama_batch(llama_batch_init(64, 0, 1)),
        [](llama_batch * p) { llama_batch_free(*p); delete p; });
    for (size_t i = 0; i < prompt.size(); i += 64) {
        if (cancelled()) return false;
        const size_t n = std::min((size_t) 64, prompt.size() - i);
        common_batch_clear(*b);
        for (size_t j = 0; j < n; ++j) common_batch_add(*b, prompt[i + j], (llama_pos) (i + j), {0}, i + j == prompt.size() - 1);
        if (llama_decode(scratch.get(), *b) != 0) return false;
    }
    common_params_sampling sp;
    sp.temp = 0.3f;
    sp.top_p = 0.9f;
    sp.penalty_repeat = 1.15f; // list-writing makes small models loop on one line
    sp.penalty_last_n = 256;
    std::unique_ptr<common_sampler, decltype(&common_sampler_free)> smp(common_sampler_init(model_, sp), &common_sampler_free);
    if (!smp) return false;
    const llama_vocab * vocab = llama_model_get_vocab(model_);
    for (int i = 0; i < max_tokens; ++i) {
        if (cancelled()) { out.clear(); return false; }
        const llama_token tok = common_sampler_sample(smp.get(), scratch.get(), -1);
        common_sampler_accept(smp.get(), tok, true);
        if (llama_vocab_is_eog(vocab, tok)) break;
        out += common_token_to_piece(scratch.get(), tok);
        common_batch_clear(*b);
        common_batch_add(*b, tok, (llama_pos) (prompt.size() + i), {0}, true);
        if (llama_decode(scratch.get(), *b) != 0) break;
    }
    if (cancelled()) { out.clear(); return false; }
    return true;
}

std::string LlmEngine::system_info() const { return llama_print_system_info(); }
