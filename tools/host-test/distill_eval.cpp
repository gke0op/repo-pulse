// The app's memory distillation, exactly: the character's notes plus its pending exchanges, cut into
// the same 6000-char chunks (Memory.chunks), each distilled in a scratch context with distill.txt.
// Prints each chunk's raw output (notes held fixed, so outputs are comparable across brains). Usage:
//   distill_eval model.gguf "Unit Seven" machine.notes.txt machine.pending.txt [max_chunks]
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "llm_engine.h"

static std::string slurp(const std::string & p) { std::ifstream f(p); std::stringstream s; s << f.rdbuf(); return s.str(); }
static void replace_all(std::string & s, const std::string & a, const std::string & b) {
    for (size_t i = s.find(a); i != std::string::npos; i = s.find(a, i + b.size())) s.replace(i, a.size(), b);
}

int main(int argc, char ** argv) {
    if (argc < 5) { std::fprintf(stderr, "usage: %s model.gguf name notes.txt pending.txt [max_chunks]\n", argv[0]); return 2; }
    const std::string name = argv[2];
    const std::string dir = std::string(__FILE__).substr(0, std::string(__FILE__).rfind('/'));
    const std::string tmpl = slurp(dir + "/../../app/src/main/assets/memory/distill.txt");
    std::string notes = slurp(argv[3]);
    while (!notes.empty() && notes.back() == '\n') notes.pop_back();
    const int max_chunks = argc > 5 ? std::atoi(argv[5]) : 99;

    // pending.txt: "U\t..." / "R\t..." line pairs, as MemoryStore writes them.
    std::vector<std::string> chunks; std::string cur, line, u;
    std::istringstream in(slurp(argv[4]));
    while (std::getline(in, line)) {
        if (line.rfind("U\t", 0) == 0) { u = line.substr(2); continue; }
        if (line.rfind("R\t", 0) != 0 || u.empty()) continue;
        std::string e = "User: " + u + "\n" + name + ": " + line.substr(2) + "\n"; u.clear();
        if (!cur.empty() && cur.size() + e.size() > 6000) { chunks.push_back(cur); cur.clear(); }
        cur += e;
    }
    if (!cur.empty()) chunks.push_back(cur);

    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    LlmEngine eng;
    if (!eng.load(argv[1], 2048, 4)) { std::fprintf(stderr, "load failed\n"); return 1; }
    const char * sys = std::getenv("DISTILL_SYSTEM") ? std::getenv("DISTILL_SYSTEM") : "You write memory notes. Follow the format exactly.";
    for (size_t i = 0; i < chunks.size() && (int) i < max_chunks; ++i) {
        std::string prompt = tmpl;
        replace_all(prompt, "{name}", name);
        replace_all(prompt, "{notes}", notes.empty() ? "(none yet)" : notes);
        replace_all(prompt, "{conversation}", chunks[i]);
        std::string out;
        auto t0 = std::chrono::steady_clock::now();
        bool ok = eng.complete_isolated(sys, prompt, 250, 4096, out);
        long ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
        std::printf("=== chunk %zu/%zu (%zu chars) %s %ld ms\n%s\n", i + 1, chunks.size(), chunks[i].size(), ok ? "ok" : "FAILED", ms, out.c_str());
    }
    llama_backend_free();
    return 0;
}
