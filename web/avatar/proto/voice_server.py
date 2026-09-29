"""The app's voice on the Mac, for the onboarding prototype (never part of the app).

The same Supertonic 3 model files the phone uses, run with ONNX Runtime directly: the pipeline
sherpa-onnx runs on the phone (duration predictor -> text encoder -> flow-matching steps -> vocoder,
44.1 kHz), with the app's settings (5 steps; per-character speaker and speed; Seven's robot filter,
ported from Voice.kt's RobotFilter). Needs only numpy, scipy and onnxruntime.

    python3 voice_server.py <model dir> [port]
    GET /tts?text=...&sid=1&speed=1.0&robot=0   -> audio/wav (16-bit mono)
    GET /tts?text=...&mix=4,5,0.5               -> a voice between two speakers (their style vectors,
                                                   interpolated: how the orb's own voice is found)
    GET /health                                 -> {"speakers": 10, "sample_rate": 44100}
"""
import io
import json
import re
import sys
import threading
import time
import unicodedata
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import onnxruntime as ort
from scipy.signal import lfilter

M = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8767
STEPS = 5  # Voice.DEFAULT_STEPS in the app

cfg = json.load(open(f"{M}/tts.json"))
SR = cfg["ae"]["sample_rate"]
CHUNK = cfg["ae"]["base_chunk_size"] * cfg["ttl"]["chunk_compress_factor"]  # samples per latent frame
LDIM = cfg["ttl"]["latent_dim"] * cfg["ttl"]["chunk_compress_factor"]
opts = ort.SessionOptions()
opts.intra_op_num_threads = 4
S = {n: ort.InferenceSession(f"{M}/{n}.int8.onnx", opts, providers=["CPUExecutionProvider"])
     for n in ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"]}

# unicode_indexer.bin: one int32 token id per BMP code point (-1: unknown).
INDEX = np.fromfile(f"{M}/unicode_indexer.bin", dtype="<i4")
# voice.bin: two int64 shapes, (speakers, 50, 256) and (speakers, 8, 16), then the float32 style
# vectors in that order: style_ttl (text-to-latent) and style_dp (duration) for each speaker.
raw = open(f"{M}/voice.bin", "rb").read()
shape_ttl, shape_dp = (tuple(int(v) for v in np.frombuffer(raw[i:i + 24], dtype="<i8")) for i in (0, 24))
n_ttl, n_dp = int(np.prod(shape_ttl)), int(np.prod(shape_dp))
TTL = np.frombuffer(raw, "<f4", n_ttl, 48).reshape(shape_ttl)
DP = np.frombuffer(raw, "<f4", n_dp, 48 + 4 * n_ttl).reshape(shape_dp)
SPEAKERS = shape_ttl[0]

# Text cleanup, as Supertonic's reference preprocessing does it, then the language tags it expects.
SWAP = {"–": "-", "‑": "-", "—": "-", "_": " ", "“": '"', "”": '"', "‘": "'", "’": "'",
        "´": "'", "`": "'", "[": " ", "]": " ", "|": " ", "/": " ", "#": " ", "→": " ", "←": " ", "…": "..."}


def prepare(text, lang="en"):
    text = unicodedata.normalize("NFKD", text)
    for k, v in SWAP.items():
        text = text.replace(k, v)
    text = re.sub(r"\s+", " ", text).strip()
    if not re.search(r"[.!?;:,'\")\]}]$", text):
        text += "."
    return f"<{lang}>{text}</{lang}>"


def robot(x):
    """Voice.kt's RobotFilter: a 55 Hz ring modulator (55% wet) into a 4 ms feedback comb."""
    n = np.arange(len(x))
    dry = 0.45 * x + 0.55 * x * np.sin(2 * np.pi * 55.0 * n / SR)
    d = int(SR * 0.004)
    a = np.zeros(d + 1)
    a[0], a[d] = 1.0, -0.35
    return np.clip(lfilter([1.0], a, dry) * 0.8, -1, 1)


lock = threading.Lock()
cache = {}


def style(sid=None, mix=None):
    """A speaker's style vectors, or a blend of two: (a, b, t) -> (1 - t) * a + t * b."""
    if mix:
        a, b, t = mix
        return ((1 - t) * TTL[a] + t * TTL[b])[None].astype(np.float32), ((1 - t) * DP[a] + t * DP[b])[None].astype(np.float32)
    return TTL[sid:sid + 1].copy(), DP[sid:sid + 1].copy()


def synth(text, sid, speed=1.0, steps=STEPS, mix=None):
    t = prepare(text)
    ids = [int(INDEX[ord(c)]) for c in t if ord(c) < len(INDEX) and INDEX[ord(c)] >= 0]
    ids = np.array([ids], dtype=np.int64)
    mask = np.ones((1, 1, ids.shape[1]), np.float32)
    ttl, dp = style(sid, mix)
    dur = S["duration_predictor"].run(None, {"text_ids": ids, "style_dp": dp, "text_mask": mask})[0] / speed
    emb = S["text_encoder"].run(None, {"text_ids": ids, "style_ttl": ttl, "text_mask": mask})[0]
    wav_len = int(float(np.ravel(dur)[0]) * SR)
    frames = max(1, (wav_len + CHUNK - 1) // CHUNK)
    x = np.random.randn(1, LDIM, frames).astype(np.float32)
    lmask = np.ones((1, 1, frames), np.float32)
    total = np.array([steps], np.float32)
    for k in range(steps):
        x = S["vector_estimator"].run(None, {
            "noisy_latent": x, "text_emb": emb, "style_ttl": ttl, "latent_mask": lmask,
            "text_mask": mask, "current_step": np.array([k], np.float32), "total_step": total})[0]
    return S["vocoder"].run(None, {"latent": x})[0][0][:wav_len]


def wav_bytes(x):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, kind):
        self.send_response(code)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/health":
            self.send(200, json.dumps({"speakers": SPEAKERS, "sample_rate": SR}).encode(), "application/json")
            return
        if u.path != "/tts" or not q.get("text", "").strip():
            self.send(404, b"", "text/plain")
            return
        try:
            sid = min(SPEAKERS - 1, max(0, int(q.get("sid", 0))))
            mix = None
            if q.get("mix"):
                a, b, t = q["mix"].split(",")
                mix = (min(SPEAKERS - 1, max(0, int(a))), min(SPEAKERS - 1, max(0, int(b))), min(1.0, max(0.0, float(t))))
            speed = float(q.get("speed", 1.0))
            key = (q["text"], mix or sid, speed, q.get("robot") == "1")
            with lock:
                if key not in cache:
                    t0 = time.time()
                    x = synth(q["text"], sid, speed, mix=mix)
                    if key[3]:
                        x = robot(x)
                    cache[key] = wav_bytes(x)
                    who = f"mix {mix[0]}-{mix[1]} {mix[2]:.2f}" if mix else f"sid {sid}"
                    print(f"voice: {who} speed {speed} robot {int(key[3])} {len(x) / SR:.1f} s audio "
                          f"in {(time.time() - t0) * 1000:.0f} ms: {q['text'][:60]}", flush=True)
                body = cache[key]
            self.send(200, body, "audio/wav")
        except Exception as e:  # a bad line must not take the prototype down
            self.send(500, str(e).encode(), "text/plain")

    def log_message(self, *a):
        pass


print(f"voice: Supertonic 3 on the Mac, {SPEAKERS} speakers, {SR} Hz, http://127.0.0.1:{PORT}", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
