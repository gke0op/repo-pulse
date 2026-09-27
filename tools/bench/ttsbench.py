import sherpa_onnx as so, time, sys

import os
M = os.environ.get("MODELS", "models-cache")
OUT = os.environ.get("OUT", ".")
SHORT = "He's the owner!"
LONG = "Honestly, I think the rain makes everything feel a little softer, don't you?"


def kokoro(d, m):
    return so.OfflineTtsModelConfig(kokoro=so.OfflineTtsKokoroModelConfig(
        model=f"{d}/{m}", voices=f"{d}/voices.bin", tokens=f"{d}/tokens.txt",
        data_dir=f"{d}/espeak-ng-data"), num_threads=4)


def kitten(d):
    return so.OfflineTtsModelConfig(kitten=so.OfflineTtsKittenModelConfig(
        model=f"{d}/model.fp16.onnx", voices=f"{d}/voices.bin", tokens=f"{d}/tokens.txt",
        data_dir=f"{d}/espeak-ng-data"), num_threads=4)


def piper(d):
    return so.OfflineTtsModelConfig(vits=so.OfflineTtsVitsModelConfig(
        model=f"{d}/en_US-lessac-medium.onnx", tokens=f"{d}/tokens.txt",
        data_dir=f"{d}/espeak-ng-data"), num_threads=4)


def supertonic(d):
    return so.OfflineTtsModelConfig(supertonic=so.OfflineTtsSupertonicModelConfig(
        duration_predictor=f"{d}/duration_predictor.int8.onnx",
        text_encoder=f"{d}/text_encoder.int8.onnx",
        vector_estimator=f"{d}/vector_estimator.int8.onnx",
        vocoder=f"{d}/vocoder.int8.onnx", tts_json=f"{d}/tts.json",
        unicode_indexer=f"{d}/unicode_indexer.bin", voice_style=f"{d}/voice.bin"), num_threads=4)


cands = {
    "kokoro-int8": lambda: kokoro(f"{M}/kokoro-int8-en-v0_19", "model.int8.onnx"),
    "kokoro-fp32": lambda: kokoro(f"{M}/kokoro-en-v0_19", "model.onnx"),
    "supertonic3": lambda: supertonic(f"{M}/sherpa-onnx-supertonic-3-tts-int8-2026-05-11"),
    "kitten-nano": lambda: kitten(f"{M}/kitten-nano-en-v0_2-fp16"),
    "piper-lessac": lambda: piper(f"{M}/vits-piper-en_US-lessac-medium"),
}
only = sys.argv[1:]
for name, mk in cands.items():
    if only and name not in only:
        continue
    try:
        t = time.time(); tts = so.OfflineTts(so.OfflineTtsConfig(model=mk())); load = time.time() - t
        tts.generate("Hi.", sid=0)
        t = time.time(); tts.generate(SHORT, sid=0); s = time.time() - t
        t = time.time(); b = tts.generate(LONG, sid=0); l = time.time() - t
        dur = len(b.samples) / b.sample_rate
        print(f"{name:13s} spk={tts.num_speakers:3d} sr={tts.sample_rate} load={load:.1f}s "
              f"short={s*1000:5.0f}ms long={l*1000:5.0f}ms/{dur*1000:5.0f}ms RTF={l/dur:.2f}", flush=True)
        so.write_wave(f"{OUT}/{name}.wav", b.samples, b.sample_rate)
    except Exception as e:
        print(name, "FAILED", e, flush=True)
