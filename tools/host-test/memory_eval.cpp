// Distills one character's exchanges from a phone session log into memory notes, using the app's
// own prompt (app/src/main/assets/memory/distill.txt), then asks the character recall questions
// with the notes in its system prompt. Usage:
//   memory_eval model.gguf session.md "Unit Seven" "What did you wish for?" ["another question"...]
#include <cstdio>
#include <fstream>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "llm_engine.h"

static std::string slurp(const std::string & p) { std::ifstream f(p); std::stringstream s; s << f.rdbuf(); return s.str(); }
static void replace_all(std::string & s, const std::string & a, const std::string & b) {
    for (size_t i = s.find(a); i != std::string::npos; i = s.find(a, i + b.size())) s.replace(i, a.size(), b);
}

int main(int argc, char ** argv) {
    if (argc < 4) { std::fprintf(stderr, "usage: %s model.gguf session.md name [question...]\n", argv[0]); return 2; }
    const std::string name = argv[3];
    const std::string dir = std::string(__FILE__).substr(0, std::string(__FILE__).rfind('/'));
    const std::string tmpl = slurp(dir + "/../../app/src/main/assets/memory/distill.txt");

    // Exchanges: "**You** (hh:mm:ss): text" followed by "**Name** [tags]: reply" (tags dropped).
    std::string log = slurp(argv[2]), conv;
    std::regex you(R"(\*\*You\*\* \([0-9:]+\): (.*))"), them(R"(\*\*(.+?)\*\*(?: \[[^\]]*\])?: (.+))");
    std::istringstream in(log); std::string line, pending_you; int n = 0;
    while (std::getline(in, line)) {
        std::smatch m;
        if (std::regex_match(line, m, you)) pending_you = m[1];
        else if (std::regex_match(line, m, them) && m[1] == name && !pending_you.empty()) {
            std::string reply = std::regex_replace(std::string(m[2]), std::regex(R"(\[[^\]]*\])"), "");
            conv += "User: " + pending_you + "\n" + name + ": " + reply + "\n";
            pending_you.clear(); ++n;
        }
    }
    // Same budget as the app: the most recent ~6000 characters of conversation per distill.
    if (conv.size() > 6000) conv = conv.substr(conv.size() - 6000);
    std::printf("%d exchanges, %zu chars of conversation\n", n, conv.size());

    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    LlmEngine eng;
    if (!eng.load(argv[1], 2048, 4)) { std::fprintf(stderr, "load failed\n"); return 1; }

    std::string prompt = tmpl;
    replace_all(prompt, "{name}", name);
    replace_all(prompt, "{notes}", "(none yet)");
    replace_all(prompt, "{conversation}", conv);
    const std::string notes = eng.complete_isolated("You write memory notes. Follow the format exactly.", prompt, 250, 4096);
    std::printf("\n--- notes ---\n%s\n-------------\n", notes.c_str());

    eng.set_system("You are " + name + ". Reply in one to three short spoken sentences. No lists.\n"
                   "What you remember from earlier conversations with the user (use it naturally, never recite it):\n" + notes);
    for (int i = 4; i < argc; ++i) {
        LlmTurnStats st;
        auto r = eng.reply(argv[i], 120, [](const std::string &) { return true; }, st, "[");
        std::printf("\nUSER: %s\n%s: %s\n", argv[i], name.c_str(), r.c_str());
    }
    llama_backend_free();
    return 0;
}
