// Reply-length drift: replays a user's real lines (one per line) through the engine with a given
// system prompt, exactly like the app (n_ctx 4096 or N_CTX env, "[" prefill, 400-token cap, history trims), and
// prints generated tokens per turn. Usage: drift_eval model.gguf system.txt user_lines.txt
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <regex>
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
    const int n_ctx = std::getenv("N_CTX") ? std::atoi(std::getenv("N_CTX")) : 4096;
    if (!eng.load(argv[1], n_ctx, 4) || !eng.set_system(ss.str())) return 1;
    for (size_t i = 0; i < lines.size(); ++i) {
        LlmTurnStats st;
        // SUFFIX env: text appended to every user message (a reminder next to the generation).
        const char * suf = std::getenv("SUFFIX");
        // SUFFIX_SKIP env: no reminder when the line matches (case-insensitive ECMAScript regex).
        const char * skip = std::getenv("SUFFIX_SKIP");
        const bool skipped = skip && std::regex_search(lines[i], std::regex(skip, std::regex::icase));
        // LONG_SUFFIX env: appended instead when SUFFIX_SKIP matched (e.g. "say the whole poem now").
        const char * lsuf = std::getenv("LONG_SUFFIX");
        const std::string sent = !suf ? lines[i] : !skipped ? lines[i] + suf : lsuf ? lines[i] + lsuf : lines[i];
        auto r = eng.reply(sent, 400, [](const std::string &) { return true; }, st, "[");
        for (char & c : r) if (c == '\n') c = ' ';
        std::printf("%zu\t%d\t%s%s\n", i + 1, st.gen_tokens, st.rebuilt ? ("[trimmed, kept " + std::to_string(st.shift_reused) + " tok] ").c_str() : "", r.c_str());
        std::fflush(stdout);
    }
    llama_backend_free();
    return 0;
}
