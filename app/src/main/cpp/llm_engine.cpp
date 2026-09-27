#include "llm_engine.h"

#include <algorithm>
#include <chrono>

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
    if (sampler_) { common_sampler_free(sampler_); sampler_ = nullptr; }
    templates_.reset();
    if (batch_.token) { llama_batch_free(batch_); batch_ = {}; }
    if (ctx_)   { llama_free(ctx_); ctx_ = nullptr; }
    if (model_) { llama_model_free(model_); model_ = nullptr; }
    msgs_.clear();
    kv_tokens_.clear();
}

bool LlmEngine::set_system(const std::string & system_prompt) {
    if (!ctx_) return false;
    msgs_.clear();
    common_chat_msg sys;
    sys.role    = "system";
    sys.content = system_prompt;
    msgs_.push_back(sys);

    // Precompute everything up to where the first user message's text will go. Rendering the
    // system message alone isn't enough: templates without a system role (Gemma) fold it into
    // the first user turn, so that render never matches the real prompt and the whole system
    // prompt was re-decoded on the first reply (measured: 276 tokens, 6.5 s on the phone).
    static const std::string MARK = "\x01\x02USER\x02\x01";
    common_chat_msg probe;
    probe.role    = "user";
    probe.content = MARK;
    const std::string full = render_text({sys, probe}, true);
    const size_t at = full.find(MARK);
    const std::string head = at == std::string::npos ? render_text(msgs_, false) : full.substr(0, at);
    LlmTurnStats ignored;
    return sync_kv(common_tokenize(ctx_, head, /*add_special*/ true, /*parse_special*/ true), ignored);
}

std::string LlmEngine::render_text(const std::vector<common_chat_msg> & msgs, bool add_generation_prompt) const {
    common_chat_templates_inputs in;
    in.messages              = msgs;
    in.add_generation_prompt = add_generation_prompt;
    in.use_jinja             = true;
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

    llama_memory_seq_rm(llama_get_memory(ctx_), 0, (llama_pos) keep, -1);
    kv_tokens_.resize(keep);

    const double t0 = now_ms();
    const bool ok = decode_from(prompt, keep);
    stats.prompt_tokens = (int) (prompt.size() - keep);
    stats.prefill_ms    = now_ms() - t0;
    return ok;
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
    cancel_.store(false);
    if (!ctx_ || msgs_.empty()) return "";

    common_chat_msg user;
    user.role    = "user";
    user.content = user_text;
    msgs_.push_back(user);

    // On overflow, trim the oldest exchanges (never the system prompt) down to 3/4 of the
    // context, so the full re-prefill this costs happens once per several turns, not every turn.
    auto prompt = render(true);
    const bool overflow = (int) prompt.size() + max_tokens > n_ctx_;
    while (overflow && (int) prompt.size() + max_tokens > n_ctx_ * 3 / 4 && msgs_.size() > 2) {
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
    if (!sync_kv(prompt, stats)) return "";

    const llama_vocab * vocab = llama_model_get_vocab(model_);
    common_sampler_reset(sampler_);

    std::string reply_text = prefix, pending;
    if (!prefix.empty() && !on_piece(prefix)) { stats.cancelled = true; }
    const double t0 = now_ms();
    for (int i = 0; i < max_tokens && !stats.cancelled; ++i) {
        if (cancel_.load()) { stats.cancelled = true; break; }
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

    common_chat_msg asst;
    asst.role    = "assistant";
    asst.content = reply_text;
    msgs_.push_back(asst);
    return reply_text;
}

std::string LlmEngine::system_info() const { return llama_print_system_info(); }
