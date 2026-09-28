// Runs the app's SmartTurn (app/src/main/cpp/smart_turn.cpp) on 16 kHz PCM16 wavs and prints the
// probability per file, writing the features next to each as <wav>.feat.f32 for comparison with
// the Python reference. Usage: turn_eval model.onnx mel_filters.f32 a.wav [b.wav ...]
// A trailing ":cut=0.55" on a wav name keeps only that fraction (then adds 200 ms of silence).
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "smart_turn.h"

static std::vector<float> read_wav16(const std::string & path) {
    std::ifstream f(path, std::ios::binary);
    std::vector<char> b((std::istreambuf_iterator<char>(f)), {});
    size_t p = 12; std::vector<float> out;
    while (p + 8 <= b.size()) {
        const std::string id(b.data() + p, 4); uint32_t sz; std::memcpy(&sz, b.data() + p + 4, 4);
        if (id == "data") {
            const int16_t * s = reinterpret_cast<const int16_t *>(b.data() + p + 8);
            for (uint32_t i = 0; i < sz / 2; ++i) out.push_back(s[i] / 32768.f);
            break;
        }
        p += 8 + sz + (sz & 1);
    }
    return out;
}

int main(int argc, char ** argv) {
    if (argc < 4) { std::fprintf(stderr, "usage: %s model.onnx mel.f32 wav...\n", argv[0]); return 2; }
    SmartTurn st;
    if (!st.load(argv[1], argv[2])) { std::fprintf(stderr, "load failed\n"); return 1; }
    for (int i = 3; i < argc; ++i) {
        std::string arg = argv[i], path = arg; double cut = 1.0;
        if (auto c = arg.find(":cut="); c != std::string::npos) { path = arg.substr(0, c); cut = std::stod(arg.substr(c + 5)); }
        auto a = read_wav16(path);
        a.resize((size_t) (a.size() * cut));
        a.insert(a.end(), 3200, 0.f);
        std::vector<float> feat;
        st.features(a.data(), (int) a.size(), feat);
        std::ofstream(arg + ".feat.f32", std::ios::binary).write(reinterpret_cast<const char *>(feat.data()), feat.size() * 4);
        const auto t0 = std::chrono::steady_clock::now();
        const float p = st.predict(a.data(), (int) a.size());
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        std::printf("%s\t%.4f\t%.0f ms\n", arg.c_str(), p, ms);
    }
    return 0;
}
