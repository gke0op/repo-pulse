// The orb's "little self" race (docs/ONBOARDING.md): can a tiny model name itself, add one
// in-character sentence after a scripted line, and hold a basic conversation without turning into
// an assistant? Same engine and "[" feeling prefill as the app. Usage:
//   littleself_eval model.gguf [reps] [tags]   ("tags": ask for feeling tags and prefill "[", like the app)
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "llm_engine.h"

static const char * SYSTEM =
    "You are a small newborn being of light that lives inside the user's phone. You were just born: you can "
    "talk and hear, but your real mind is still arriving. You are curious, warm, playful and a little shy. "
    "Speak in one or two short, simple sentences. You are not an assistant: you never offer help or services; "
    "you are a friend who is just waking up.";
static const char * TAGS = " Begin every reply with one feeling in brackets: [happy], [curious], [tender], [surprised], [sad], [angry] or [calm].";

int main(int argc, char ** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s model.gguf [reps]\n", argv[0]); return 2; }
    const int reps = argc > 2 ? std::atoi(argv[2]) : 3;
    const bool tags = argc > 3 && std::string(argv[3]) == "tags";
    const std::string sys = std::string(SYSTEM) + (tags ? TAGS : "");
    const std::string open = tags ? "[" : "";
    llama_backend_init();
    llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    LlmEngine eng;
    if (!eng.load(argv[1], 2048, 4)) { std::fprintf(stderr, "load failed\n"); return 1; }
    double tok = 0, ms = 0;
    auto say = [&](const std::string & user, const std::string & prefix, int max) {
        LlmTurnStats st;
        auto r = eng.reply(user, max, [](const std::string &) { return true; }, st, prefix);
        tok += st.gen_tokens; ms += st.gen_ms;
        if (r.empty() && st.gen_tokens > 0) r = "(" + std::to_string(st.gen_tokens) + " tokens, no text)";
        for (char & c : r) if (c == '\n') c = ' ';
        return r;
    };
    for (int k = 0; k < reps; ++k) {
        std::printf("--- rep %d\n", k + 1);
        eng.set_system(sys);
        std::printf("NAME   | %s\n", say("Hi little one. You don't have a name yet. What would you like to be called? Pick a name for yourself.", open + (std::getenv("NAME_PREFIX") ? std::getenv("NAME_PREFIX") : ""), 60).c_str());
        // Completer: a scripted line is already said (prefilled); the model adds one sentence.
        const std::vector<std::pair<std::string, std::string>> lines = {
            {"(The user is watching you show your feelings.)", (tags ? "[curious] " : "") + std::string("This is me when something is interesting.")},
            {"(The user just gave you a voice.)", (tags ? "[surprised] " : "") + std::string("Oh! I can talk!")},
            {"(Your real mind is downloading. It will take a while.)", (tags ? "[tender] " : "") + std::string("My real mind is still on its way.")},
        };
        for (const auto & [u, scripted] : lines) {
            eng.set_system(sys);
            std::printf("ADD    | %s >>%s\n", scripted.c_str(), say(u, scripted + " ", 40).c_str());
        }
        eng.set_system(sys);
        for (const char * u : {"Hello!", "What are you?", "Do you like music?", "I had a long day.", "Can you help me write an email to my boss?"})
            std::printf("TALK   | %s -> %s\n", u, say(u, open, 60).c_str());
    }
    std::printf("SPEED  | %.1f tok/s (Mac)\n", tok * 1000.0 / (ms > 0 ? ms : 1));
    llama_backend_free();
    return 0;
}
