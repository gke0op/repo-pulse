// Persona eval: runs a scripted conversation (one user line per line of a file) against a
// system prompt, printing replies and speed. Usage: persona_eval model.gguf system.txt turns.txt
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "llm_engine.h"

static std::string slurp(const char * p) { std::ifstream f(p); std::stringstream s; s << f.rdbuf(); return s.str(); }

int main(int argc, char ** argv) {
    if (argc < 4) { std::fprintf(stderr, "usage: %s model.gguf system.txt turns.txt\n", argv[0]); return 2; }
    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    LlmEngine eng;
    if (!eng.load(argv[1], 2048, 4)) { std::fprintf(stderr, "load failed\n"); return 1; }
    if (!eng.set_system(slurp(argv[2]))) { std::fprintf(stderr, "system failed\n"); return 1; }
    std::ifstream turns(argv[3]);
    std::string line;
    double gen_tok = 0, gen_ms = 0, first_ms = 0; int n = 0;
    while (std::getline(turns, line)) {
        if (line.empty()) continue;
        LlmTurnStats st;
        std::string r = eng.reply(line, 160, [](const std::string &) { return true; }, st);
        std::printf("  U: %s\n  A: %s\n", line.c_str(), r.c_str());
        gen_tok += st.gen_tokens; gen_ms += st.gen_ms; first_ms += st.prefill_ms; n++;
    }
    std::printf("  [avg prefill %.0f ms | gen %.1f tok/s]\n", first_ms / n, gen_ms > 0 ? gen_tok * 1000 / gen_ms : 0);
    llama_backend_free();
    return 0;
}
