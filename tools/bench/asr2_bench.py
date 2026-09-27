"""Offline (second-pass) ASR race on clean and phone-degraded conversational speech."""
import time
import numpy as np
import sherpa_onnx as so

import os
M = os.environ.get("MODELS", "models-cache")
rng = np.random.default_rng(0)

# ---------- test set: conversational lines in several TTS voices ----------
kd = f"{M}/kokoro-en-v0_19"
kokoro = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(kokoro=so.OfflineTtsKokoroModelConfig(
    model=f"{kd}/model.onnx", voices=f"{kd}/voices.bin", tokens=f"{kd}/tokens.txt",
    data_dir=f"{kd}/espeak-ng-data"), num_threads=4)))
lines = [
    ("hello mira how are you doing tonight", 0),
    ("let us talk about something else for a while", 7),   # bf_emma (British)
    ("what about the other one", 9),                       # bm_george (British)
    ("no no i said the blue one not the red one", 5),
    ("can you tell me a story about a tiger", 10),         # bm_lewis
    ("i am tired but i want to keep talking to you", 3),
]
babble_src = kokoro.generate("the weather report says it will rain tomorrow in the afternoon and evening", sid=6)


def to16k(samples, sr):
    x = np.asarray(samples, dtype=np.float32)
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def bandpass_phone(x):
    """Crude call-audio emulation: 300-3400 Hz via FFT mask."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / 16000)
    X[(f < 300) | (f > 3400)] *= 0.05
    return np.fft.irfft(X, len(x)).astype(np.float32)


def degrade(x):
    b = to16k(babble_src.samples, babble_src.sample_rate)
    b = np.resize(b, len(x))
    rms = lambda v: np.sqrt((v ** 2).mean()) + 1e-9
    y = x + b * (rms(x) / rms(b)) * 10 ** (-8 / 20)            # talker 8 dB below
    y = y + rng.normal(0, rms(x) * 10 ** (-12 / 20), len(x))  # noise at 12 dB SNR
    return bandpass_phone(y.astype(np.float32))


clean, hard = [], []
for text, sid in lines:
    a = kokoro.generate(text, sid=sid)
    x = to16k(a.samples, a.sample_rate)
    clean.append((text, x))
    hard.append((text, degrade(x)))


def wer(ref, hyp):
    r, h = ref.split(), hyp.split()
    d = np.arange(len(h) + 1)
    for i in range(1, len(r) + 1):
        prev, d[0] = d.copy(), i
        for j in range(1, len(h) + 1):
            d[j] = min(prev[j] + 1, d[j - 1] + 1, prev[j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(h)] / len(r)


def norm(s):
    s = s.lower().replace("'", "")
    return " ".join("".join(c if c.isalnum() or c == " " else " " for c in s).split())


# ---------- candidates ----------
def streaming_zipformer():
    d = f"{M}/sherpa-onnx-streaming-zipformer-en-2023-06-26"
    sfx = "epoch-99-avg-1-chunk-16-left-128.int8.onnx"
    return so.OnlineRecognizer.from_transducer(
        tokens=f"{d}/tokens.txt", encoder=f"{d}/encoder-{sfx}", decoder=f"{d}/decoder-{sfx}",
        joiner=f"{d}/joiner-{sfx}", num_threads=2, sample_rate=16000, feature_dim=80,
        decoding_method="modified_beam_search")


cands = {
    "zipformer (current)": ("online", streaming_zipformer),
    "moonshine-base-q": ("offline", lambda: so.OfflineRecognizer.from_moonshine_v2(
        encoder=f"{M}/sherpa-onnx-moonshine-base-en-quantized-2026-02-27/encoder_model.ort",
        decoder=f"{M}/sherpa-onnx-moonshine-base-en-quantized-2026-02-27/decoder_model_merged.ort",
        tokens=f"{M}/sherpa-onnx-moonshine-base-en-quantized-2026-02-27/tokens.txt", num_threads=2)),
    "whisper-base.en-int8": ("offline", lambda: so.OfflineRecognizer.from_whisper(
        encoder=f"{M}/sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx",
        decoder=f"{M}/sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx",
        tokens=f"{M}/sherpa-onnx-whisper-base.en/base.en-tokens.txt", language="en", num_threads=2)),
    "canary-180m-flash": ("offline", lambda: so.OfflineRecognizer.from_nemo_canary(
        encoder=f"{M}/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8/encoder.int8.onnx",
        decoder=f"{M}/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8/decoder.int8.onnx",
        tokens=f"{M}/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8/tokens.txt",
        src_lang="en", tgt_lang="en", num_threads=2)),
    "parakeet-tdt-0.6b-v2": ("offline", lambda: so.OfflineRecognizer.from_transducer(
        encoder=f"{M}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/encoder.int8.onnx",
        decoder=f"{M}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/decoder.int8.onnx",
        joiner=f"{M}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/joiner.int8.onnx",
        tokens=f"{M}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/tokens.txt",
        model_type="nemo_transducer", num_threads=2)),
}


def run(kind, rec, x):
    if kind == "offline":
        s = rec.create_stream()
        s.accept_waveform(16000, x)
        rec.decode_stream(s)
        return s.result.text
    s = rec.create_stream()
    for i in range(0, len(x), 1600):
        s.accept_waveform(16000, x[i:i + 1600])
        while rec.is_ready(s):
            rec.decode_stream(s)
    s.accept_waveform(16000, np.zeros(9600, dtype=np.float32))
    s.input_finished()
    while rec.is_ready(s):
        rec.decode_stream(s)
    return rec.get_result(s)


for name, (kind, mk) in cands.items():
    try:
        t = time.time(); rec = mk(); load = time.time() - t
        run(kind, rec, clean[0][1])  # warm-up
        res = {}
        for label, data in (("clean", clean), ("hard", hard)):
            ws, tt, aa, hyps = [], 0.0, 0.0, []
            for ref, x in data:
                t = time.time(); hyp = norm(run(kind, rec, x)); tt += time.time() - t
                aa += len(x) / 16000
                ws.append(wer(norm(ref), hyp)); hyps.append(hyp)
            res[label] = (np.mean(ws) * 100, tt / aa, hyps)
        print(f"{name:22s} load={load:4.1f}s  WER clean={res['clean'][0]:5.1f}%  hard={res['hard'][0]:5.1f}%  RTF={res['hard'][1]:.3f}", flush=True)
        for (ref, _), hyp in zip(hard, res["hard"][2]):
            if norm(ref) != hyp:
                print(f"      hard: {hyp!r}   (ref: {ref})", flush=True)
    except Exception as e:
        print(name, "FAILED", e, flush=True)
