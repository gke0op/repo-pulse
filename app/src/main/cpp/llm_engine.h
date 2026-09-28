// Plain C++ LLM engine on top of llama.cpp. No JNI in here so it can be
// built and tested on a desktop host (see tools/host-test).
#pragma once

#include <atomic>
#include <functional>
#include <string>
#include <vector>

#include "chat.h"
#include "llama.h"

struct common_sampler;

struct LlmTurnStats {
    int    prompt_tokens = 0;   // tokens decoded for this turn's prompt
    double prefill_ms    = 0;   // time to decode the prompt
    int    gen_tokens    = 0;   // tokens generated
    double gen_ms        = 0;   // time spent generating
    bool   rebuilt       = false; // context overflowed and history was trimmed
    int    shift_reused  = 0;     // on a trim: cached tokens kept by shifting instead of re-decoding
    bool   cancelled     = false;
};

class LlmEngine {
public:
    // Return false from the callback to stop generation early.
    using PieceFn = std::function<bool(const std::string &)>;

    ~LlmEngine();

    // n_threads_batch: prompt processing is compute-bound and scales with more cores than
    // token generation (memory-bound); 0 = same as n_threads.
    bool load(const std::string & path, int n_ctx, int n_threads, int n_threads_batch = 0);
    void unload();
    bool loaded() const { return model_ != nullptr; }

    // Resets the conversation and decodes the system prompt (kept as a cached prefix).
    bool set_system(const std::string & system_prompt);

    // Appends a user message and streams the assistant reply through on_piece.
    // Returns the full reply text (partial if cancelled).
    // [prefix] is placed at the start of the assistant turn and the model continues from it
    // ("prefilling"), e.g. "[" to make any model open its reply with an emotion tag. The
    // prefix is part of the returned text and is streamed first.
    std::string reply(const std::string & user_text, int max_tokens,
                      const PieceFn & on_piece, LlmTurnStats & stats,
                      const std::string & prefix = "");

    void cancel() { cancel_.store(true); }

    // Voice first: while true, generation waits between tokens (up to MAX_HOLD_MS per hold), so
    // the first speech chunk synthesizes without competing for the CPU. cancel() still wins.
    void hold(bool on) { hold_.store(on); }

    // Forget the last reply if nobody heard it (cancelled before any audio played). The user
    // message stays, so the next one joins it. No-op if the last reply() stored nothing.
    void retract_last_reply();

    // One-off completion in a scratch context (the conversation's cache is untouched), e.g. to
    // distill memories. Low temperature; cancel() aborts it. Returns "" on failure or cancel.
    std::string complete_isolated(const std::string & system, const std::string & user, int max_tokens, int n_ctx);

    std::string system_info() const;

private:
    std::string render_text(const std::vector<common_chat_msg> & msgs, bool add_generation_prompt) const;
    std::vector<llama_token> render(bool add_generation_prompt) const;
    bool sync_kv(const std::vector<llama_token> & prompt, LlmTurnStats & stats);
    size_t shift_out_dropped(const std::vector<llama_token> & prompt);
    bool decode_from(const std::vector<llama_token> & tokens, size_t start);

    llama_model *             model_   = nullptr;
    llama_context *           ctx_     = nullptr;
    common_sampler *          sampler_ = nullptr;
    common_chat_templates_ptr templates_;
    llama_batch               batch_{};
    int                       n_ctx_   = 0;
    int                       n_batch_ = 512;

    std::vector<common_chat_msg> msgs_;      // msgs_[0] is the system message
    std::vector<llama_token>     kv_tokens_; // exactly what is in the KV cache, in order
    std::atomic<bool>            cancel_{false};
    std::atomic<bool>            hold_{false};
    bool                         last_reply_stored_ = false;
};
