"""Renders a Unit Seven line like the app does (Supertonic sid 9, speed 0.92, robot filter)
and writes the WAV plus per-chunk lip-sync envelopes (same math as Envelope.kt) as JSON.
Usage: python3 voice_line.py <supertonic_dir> <out_dir>
"""
import json, math, sys, wave
import numpy as np
import sherpa_onnx as so

model_dir, out = sys.argv[1], sys.argv[2]
CHUNKS = ["Loneliness is a human construct.", "I do not experience it the same way.",
          "It is an observation, not an emotion.", "Why do you ask?"]

tts = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
    supertonic=so.OfflineTtsSupertonicModelConfig(
        duration_predictor=f"{model_dir}/duration_predictor.int8.onnx",
        text_encoder=f"{model_dir}/text_encoder.int8.onnx",
        vector_estimator=f"{model_dir}/vector_estimator.int8.onnx",
        vocoder=f"{model_dir}/vocoder.int8.onnx", tts_json=f"{model_dir}/tts.json",
        unicode_indexer=f"{model_dir}/unicode_indexer.bin", voice_style=f"{model_dir}/voice.bin"),
    num_threads=4)))


class Robot:  # port of RobotFilter in Voice.kt
    def __init__(self, sr, ring_hz=55.0):
        self.sr, self.ring, self.phase = sr, ring_hz, 0.0
        self.comb = np.zeros(int(sr * 0.004), dtype=np.float32)
        self.pos = 0

    def apply(self, x):
        out = np.empty_like(x)
        step = 2 * math.pi * self.ring / self.sr
        for i, v in enumerate(x):
            ring = v * math.sin(self.phase)
            self.phase += step
            if self.phase > 2 * math.pi:
                self.phase -= 2 * math.pi
            y = 0.45 * v + 0.55 * ring + 0.35 * self.comb[self.pos]
            self.comb[self.pos] = y
            self.pos = (self.pos + 1) % len(self.comb)
            out[i] = max(-1.0, min(1.0, y * 0.8))
        return out


def envelope(x, sr, frame_ms=20, gate=0.008):  # port of Envelope.of
    frame = max(1, sr * frame_ms // 1000)
    rms = [float(np.sqrt(np.mean(x[i:i + frame] ** 2))) for i in range(0, len(x), frame)]
    peak = max(max(rms), 0.02)
    return [0.0 if r < gate else math.sqrt(min(max(r / peak, 0), 1)) for r in rms]


robot, parts, chunks, t = None, [], [], 0.0
for text in CHUNKS:
    a = tts.generate(text, sid=9, speed=0.92)
    sr = a.sample_rate
    robot = robot or Robot(sr)
    x = robot.apply(np.array(a.samples, dtype=np.float32))
    chunks.append({"text": text, "start": round(t, 3), "env": [round(v, 2) for v in envelope(x, sr)]})
    parts.append(x)
    t += len(x) / sr

audio = np.concatenate(parts)
with wave.open(f"{out}/unit7_line.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((audio * 32767).astype(np.int16).tobytes())
json.dump({"chunks": chunks, "duration": t}, open(f"{out}/unit7_line.json", "w"))
print(f"{len(chunks)} chunks, {t:.2f}s audio at {sr} Hz")
