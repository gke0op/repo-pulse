import numpy as np
import os
import sherpa_onnx as so

M = os.environ.get("MODELS", "models-cache")

d = M + "/sherpa-onnx-supertonic-3-tts-int8-2026-05-11"
OUT = os.environ.get("OUT", ".")
tts = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
    supertonic=so.OfflineTtsSupertonicModelConfig(
        duration_predictor=f"{d}/duration_predictor.int8.onnx",
        text_encoder=f"{d}/text_encoder.int8.onnx",
        vector_estimator=f"{d}/vector_estimator.int8.onnx",
        vocoder=f"{d}/vocoder.int8.onnx", tts_json=f"{d}/tts.json",
        unicode_indexer=f"{d}/unicode_indexer.bin", voice_style=f"{d}/voice.bin"),
    num_threads=4)))


def f0(x, sr):
    fr = int(0.04 * sr)
    out = []
    for i in range(0, len(x) - fr, fr):
        s = x[i:i + fr]
        if np.sqrt((s ** 2).mean()) < 0.02:
            continue
        s = s - s.mean()
        ac = np.correlate(s, s, "full")[fr - 1:]
        lo, hi = int(sr / 400), int(sr / 60)
        k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.3 * ac[0]:
            out.append(sr / k)
    return np.median(out) if out else 0


for sid in range(tts.num_speakers):
    a = tts.generate("Hey, long day? Come sit with me for a bit.", sid=sid)
    x = np.array(a.samples)
    print(sid, round(f0(x, a.sample_rate)), "Hz", flush=True)
    so.write_wave(f"{OUT}/supertonic_sid{sid}.wav", a.samples, a.sample_rate)
