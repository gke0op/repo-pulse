// Runs a scripted conversation through LlmEngine and prints streamed pieces + stats.
#include <cstdio>
#include <string>

#include "llm_engine.h"

int main(int argc, char ** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s model.gguf [n_ctx]\n", argv[0]); return 2; }
    const int n_ctx = argc > 2 ? std::atoi(argv[2]) : 2048;

    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);

    LlmEngine eng;
    if (!eng.load(argv[1], n_ctx, 4)) { std::fprintf(stderr, "load failed\n"); return 1; }
    if (!eng.set_system("You are Mira, a warm, playful companion. Reply in one to three short spoken sentences. No lists, no emojis.")) {
        std::fprintf(stderr, "system prompt failed\n"); return 1;
    }

    const char * turns[] = {
        "Hey, I'm Ekmel. Long day. What have you been up to?",
        "Do you remember my name?",
        "Tell me something that made you curious today.",
    };
    for (const char * t : turns) {
        std::printf("\nUSER: %s\nMIRA: ", t);
        LlmTurnStats st;
        eng.reply(t, 128, [](const std::string & p) { std::printf("%s", p.c_str()); std::fflush(stdout); return true; }, st);
        std::printf("\n  [prefill %d tok %.0f ms | gen %d tok %.0f ms = %.1f tok/s%s]\n",
                    st.prompt_tokens, st.prefill_ms, st.gen_tokens, st.gen_ms,
                    st.gen_ms > 0 ? st.gen_tokens * 1000.0 / st.gen_ms : 0.0, st.rebuilt ? " | rebuilt" : "");
    }

    // Cancellation: stop after the first 5 pieces.
    std::printf("\nUSER: Tell me a long story.\nMIRA (cut after 5 pieces): ");
    LlmTurnStats st; int n = 0;
    eng.reply("Tell me a long story.", 256, [&](const std::string & p) { std::printf("%s", p.c_str()); return ++n < 5; }, st);
    std::printf("\n  [cancelled=%d gen=%d]\n", st.cancelled, st.gen_tokens);

    // Tiny context forces history trimming.
    LlmEngine small;
    small.load(argv[1], 256, 4);
    small.set_system("You are terse.");
    for (int i = 0; i < 16; ++i) {
        LlmTurnStats s2;
        auto r = small.reply("Say a random word and nothing else.", 64, [](const std::string &) { return true; }, s2);
        std::printf("small ctx turn %d: '%s' rebuilt=%d prefill_tok=%d\n", i, r.c_str(), s2.rebuilt, s2.prompt_tokens);
    }
    llama_backend_free();
    return 0;
}
