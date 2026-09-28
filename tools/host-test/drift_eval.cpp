// Reply-length drift: replays a user's real lines (one per line) through the engine with a given
// system prompt, exactly like the app (n_ctx 2048, "[" prefill, 400-token cap, history trims), and
// prints generated tokens per turn. Usage: drift_eval model.gguf system.txt user_lines.txt
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "llm_engine.h"

int main(int argc, char ** argv) {
    if (argc < 4) { std::fprintf(stderr, "usage: %s model.gguf system.txt lines.txt\n", argv[0]); return 2; }
    std::ifstream sf(argv[2]); std::stringstream ss; ss << sf.rdbuf();
    std::ifstream lf(argv[3]); std::vector<std::string> lines; for (std::string l; std::getline(lf, l);) if (!l.empty()) lines.push_back(l);
    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    LlmEngine eng;
    if (!eng.load(argv[1], 2048, 4) || !eng.set_system(ss.str())) return 1;
    for (size_t i = 0; i < lines.size(); ++i) {
        LlmTurnStats st;
        auto r = eng.reply(lines[i], 400, [](const std::string &) { return true; }, st, "[");
        for (char & c : r) if (c == '\n') c = ' ';
        std::printf("%zu\t%d\t%s\n", i + 1, st.gen_tokens, r.substr(0, 90).c_str());
        std::fflush(stdout);
    }
    llama_backend_free();
    return 0;
}
