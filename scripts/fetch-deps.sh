#!/usr/bin/env bash
# Fetches pinned native dependencies that are too big to commit:
#   - llama.cpp source (built from source by the app's CMake)
#   - sherpa-onnx prebuilt Android libs (TTS runtime + ONNX Runtime)
set -euo pipefail

LLAMA_TAG=b11201
SHERPA_VER=v1.13.8
# The ONNX Runtime sherpa-onnx ships (strings libonnxruntime.so: 1.28.2): its C API headers, for smart_turn.cpp.
ORT_VER=v1.28.2

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$ROOT/third_party/llama.cpp/.git" ]; then
  git clone --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$ROOT/third_party/llama.cpp"
fi

JNI="$ROOT/app/src/main/jniLibs/arm64-v8a"
if [ ! -f "$JNI/libsherpa-onnx-jni.so" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/sherpa.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/$SHERPA_VER/sherpa-onnx-$SHERPA_VER-android.tar.bz2"
  tar xjf "$tmp/sherpa.tar.bz2" -C "$tmp"
  mkdir -p "$JNI"
  cp "$tmp/jniLibs/arm64-v8a/libsherpa-onnx-jni.so" "$tmp/jniLibs/arm64-v8a/libonnxruntime.so" "$JNI/"
  rm -rf "$tmp"
fi
ORT_INC="$ROOT/third_party/onnxruntime-include"
if [ ! -f "$ORT_INC/onnxruntime_c_api.h" ]; then
  mkdir -p "$ORT_INC"
  for h in onnxruntime_c_api.h onnxruntime_ep_c_api.h onnxruntime_error_code.h; do
    curl -fsSL -o "$ORT_INC/$h" "https://raw.githubusercontent.com/microsoft/onnxruntime/$ORT_VER/include/onnxruntime/core/session/$h"
  done
fi
echo "deps ready"
