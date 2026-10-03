#!/usr/bin/env bash
# Build a flat working dir (slm-lab/work, gitignored) with sources, toolchain, models and converted weights.
# Needs: x86-64 CPU with AVX-512 VNNI (Sapphire/Emerald Rapids, Zen 4+), python3, cmake, git, curl.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
W=$HERE/work
mkdir -p "$W/voice" && cd "$W"

ln -sf "$HERE"/engine/*.zig "$HERE"/bench/* "$HERE"/py/*.py "$HERE"/data/* .
ln -sf "$HERE/voice/loop.py" voice/loop.py

# Zig 0.17.0
[ -x zig-x86_64-linux-0.17.0/zig ] || curl -sL https://ziglang.org/download/0.17.0/zig-x86_64-linux-0.17.0.tar.xz | tar xJ
ZIG=$W/zig-x86_64-linux-0.17.0/zig

# llama.cpp: gguf-py (readers), llama-tokenize, llama-bench (baseline)
[ -d llama.cpp ] || git clone -q --depth 1 https://github.com/ggml-org/llama.cpp
[ -x llama.cpp/build/bin/llama-bench ] || (cd llama.cpp && cmake -B build -DGGML_NATIVE=ON -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null \
    && cmake --build build -j --target llama-bench llama-tokenize >/dev/null)

pip install -q --break-system-packages numpy scipy tokenizers huggingface_hub 2>/dev/null || pip install -q numpy scipy tokenizers huggingface_hub

# models
HF=https://huggingface.co
get() { [ -s "$2" ] || curl -sL -o "$2" "$HF/$1"; }
get bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q8_0.gguf q.gguf
get bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf s4.gguf
get ggml-org/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf g8.gguf
get ggml-org/gemma-3-270m-it-qat-GGUF/resolve/main/gemma-3-270m-it-qat-Q4_0.gguf gq4.gguf
mkdir -p hfg
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json generation_config.json; do
    get unsloth/gemma-3-270m-it/resolve/main/$f hfg/$f
done

# convert to engine formats
[ -s smol.sun ] || python3 convert.py q.gguf smol.sun
[ -s gemma.sun ] || python3 gemma.py convert                         # Gemma per-row Q8
[ -s gemma_ri.sun ] || python3 gemma.py convert_ri                   # Gemma row-interleaved Q8
[ -s gemma_qat.sun ] || GGUF=gq4.gguf python3 gemma.py convert_ri gemma_qat.sun   # QAT: RI-Q4 body + RI-Q8 head

# build
for f in gri gemma sun gspec; do "$ZIG" build-exe $f.zig -O ReleaseFast -mcpu=native; done
echo "ready: cd $W && ./gri qat pp   (see README for the rest)"
