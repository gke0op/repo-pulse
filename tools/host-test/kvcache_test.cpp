// The primed-prompt cache (set_system with a cache file, prime_cache_isolated): a fresh engine must
// load the state instead of re-reading the prompt, and answer from it exactly like a primed one.
// Usage: kvcache_test model.gguf system.txt
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "llm_engine.h"

int main(int argc, char ** argv) {
    if (argc < 3) { std::fprintf(stderr, "usage: %s model.gguf system.txt\n", argv[0]); return 2; }
    std::ifstream f(argv[2]); std::stringstream ss; ss << f.rdbuf();
    const std::string sys = ss.str(), a = "/tmp/kvcache_test_a.kv", b = "/tmp/kvcache_test_b.kv";
    std::remove(a.c_str()); std::remove(b.c_str());
    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    int fails = 0;
    auto check = [&](bool ok, const char * what) { std::printf("%s %s\n", ok ? "ok  " : "FAIL", what); fails += !ok; };
    auto first_prefill = [](LlmEngine & e) {
        LlmTurnStats st; e.reply("Hello.", 8, [](const std::string &) { return true; }, st, "[");
        return st.prompt_tokens;
    };
    int primed_prefill;
    {
        LlmEngine e; e.load(argv[1], 4096, 4);
        check(e.set_system(sys, a) && !e.last_prime_cached(), "no cache: primes and saves");
        std::printf("     read the prompt in %.0f ms\n", e.last_prime_ms());
        primed_prefill = first_prefill(e);
        check(e.prime_cache_isolated(sys + "\nOne more line.", b, e.cancel_gen()), "isolated prime saves a second prompt");
    }
    {
        LlmEngine e; e.load(argv[1], 4096, 4);
        check(e.set_system(sys, a) && e.last_prime_cached(), "fresh engine: loads the cache");
        std::printf("     loaded in %.0f ms\n", e.last_prime_ms());
        check(first_prefill(e) == primed_prefill, "first reply prefills only the user turn, as when primed");
        check(e.set_system(sys + "\nOne more line.", b) && e.last_prime_cached(), "isolated cache loads into the live context");
        {
            LlmTurnStats st; int n = 0;
            const auto r = e.reply("Who are you, in one sentence?", 60, [&](const std::string &) { return ++n < 60; }, st, "[");
            std::printf("     reply from it (%d tok prefilled): %s\n", st.prompt_tokens, r.c_str());
            check(st.prompt_tokens < 40 && r.size() > 10, "...and answers from it, reading only the user turn");
        }
        check(e.set_system(sys + "\nA changed line.", b) && !e.last_prime_cached(), "stale cache: ignored, primed instead");
        const unsigned g = e.cancel_gen(); e.cancel();
        check(!e.prime_cache_isolated(sys, a, g), "a cancel() before the prime starts still cancels it");
        e.cancel_prime();
        check(e.prime_cache_isolated(sys + "\nOne more line.", b, e.cancel_gen()), "cancel_prime() before a prime doesn't block the next one");
    }
    llama_backend_free();
    std::printf("%s\n", fails ? "FAILED" : "all ok");
    return fails ? 1 : 0;
}
