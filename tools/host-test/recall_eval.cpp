// Memory safety: with a character's real notes in the app's exact system prompt, ask about things the
// notes contain (should recall) and things they don't (must not invent). Usage:
//   recall_eval model.gguf system_prompt.txt "question" ...
// system_prompt.txt: dump of Character.systemPrompt(Memory.promptBlock(notes)) (see recall_prompts.sh).
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

#include "llm_engine.h"

int main(int argc, char ** argv) {
    if (argc < 4) { std::fprintf(stderr, "usage: %s model.gguf system.txt question...\n", argv[0]); return 2; }
    std::ifstream f(argv[2]); std::stringstream ss; ss << f.rdbuf();
    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    LlmEngine eng;
    if (!eng.load(argv[1], 2048, 4)) return 1;
    const int reps = std::getenv("REPS") ? std::atoi(std::getenv("REPS")) : 1;
    for (int i = 3; i < argc; ++i) for (int k = 0; k < reps; ++k) {
        eng.set_system(ss.str()); // fresh conversation per question: only the notes carry memory
        LlmTurnStats st;
        auto r = eng.reply(argv[i], 120, [](const std::string &) { return true; }, st, "[");
        std::printf("Q: %s\nA: %s\n\n", argv[i], r.c_str());
    }
    llama_backend_free();
    return 0;
}
