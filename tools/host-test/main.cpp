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
        std::printf("small ctx turn %d: '%s' rebuilt=%d shift_reused=%d prefill_tok=%d\n", i, r.c_str(), s2.rebuilt, s2.shift_reused, s2.prompt_tokens);
    }

    // Realistic trims: persona chat with the "[" prefill in a small context, so the oldest
    // exchanges are shifted out every few turns. A fact told after the early trims must survive.
    eng.unload();
    small.unload();
    LlmEngine chat;
    if (!chat.load(argv[1], 448, 4)) { std::fprintf(stderr, "chat load failed\n"); return 1; }
    chat.set_system("You are Mira, a warm, playful companion. Open every reply with one feeling tag like [happy]. "
                    "Reply in one or two short spoken sentences. Only bring up what the user actually said.");
    const char * lines[] = {
        "Hi Mira, it's late and I can't sleep.", "I've been building an app all day.", "It has three characters.",
        "One of them is a machine with a porcelain mask.", "The mask is mended with gold.", "Do you like music?",
        "I listen to a lot of jazz.", "My cat is called Pixel.",
        "I made tea, chamomile.", "Do you like rain?", "Tell me about your day.", "I think I'll sleep soon.",
        "What was my cat's name?", "Do you remember what tea I made?", "What music do I listen to?",
        "Okay, one more thing: my sister is called Lale.", "Say goodnight to Pixel for me.", "Who is Lale?",
    };
    for (const char * t : lines) {
        LlmTurnStats s3;
        auto r = chat.reply(t, 96, [](const std::string &) { return true; }, s3, "[");
        std::printf("chat: prefill %3d tok %6.0f ms%s | %s -> %s\n", s3.prompt_tokens, s3.prefill_ms,
                    s3.rebuilt ? (" | trimmed, shift kept " + std::to_string(s3.shift_reused)).c_str() : "", t, r.c_str());
    }
    llama_backend_free();
    return 0;
}
