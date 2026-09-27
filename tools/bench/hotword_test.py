import numpy as np
import sherpa_onnx as so

import os
M = os.environ.get("MODELS", "models-cache")
S = os.environ.get("OUT", ".")
d = f"{M}/sherpa-onnx-streaming-zipformer-en-2023-06-26"
sfx = "epoch-99-avg-1-chunk-16-left-128.int8.onnx"

st_dir = f"{M}/sherpa-onnx-supertonic-3-tts-int8-2026-05-11"
tts = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
    supertonic=so.OfflineTtsSupertonicModelConfig(
        duration_predictor=f"{st_dir}/duration_predictor.int8.onnx",
        text_encoder=f"{st_dir}/text_encoder.int8.onnx",
        vector_estimator=f"{st_dir}/vector_estimator.int8.onnx",
        vocoder=f"{st_dir}/vocoder.int8.onnx", tts_json=f"{st_dir}/tts.json",
        unicode_indexer=f"{st_dir}/unicode_indexer.bin", voice_style=f"{st_dir}/voice.bin"),
    num_threads=4)))

# Different speakers than the characters' own voices, to mimic "the user".
phrases = [("Hello Mira.", 3), ("Hey Mira, how are you?", 7), ("Hi Kai.", 2),
           ("Hello Unit Seven.", 8), ("Mira, what do you think about rain?", 0)]
clips = []
for text, sid in phrases:
    a = tts.generate(text, sid=sid)
    x = np.array(a.samples, dtype=np.float32)
    n = int(len(x) * 16000 / a.sample_rate)
    x16 = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    clips.append((text, x16))

hot = f"{S}/hotwords.txt"
open(hot, "w").write("MIRA\nKAI\nUNIT SEVEN\n")


def make(method, hotwords):
    kw = dict(tokens=f"{d}/tokens.txt", encoder=f"{d}/encoder-{sfx}", decoder=f"{d}/decoder-{sfx}",
              joiner=f"{d}/joiner-{sfx}", num_threads=2, sample_rate=16000, feature_dim=80,
              decoding_method=method)
    if hotwords:
        kw.update(hotwords_file=hot, hotwords_score=2.0, modeling_unit="bpe", bpe_vocab=f"{d}/bpe.vocab")
    return so.OnlineRecognizer.from_transducer(**kw)


for label, rec in [("greedy", make("greedy_search", False)),
                   ("beam", make("modified_beam_search", False)),
                   ("beam+hotwords", make("modified_beam_search", True))]:
    print(f"== {label}")
    for text, x in clips:
        s = rec.create_stream()
        for i in range(0, len(x), 1600):
            s.accept_waveform(16000, x[i:i + 1600])
            while rec.is_ready(s):
                rec.decode_stream(s)
        s.accept_waveform(16000, np.zeros(9600, dtype=np.float32))
        s.input_finished()
        while rec.is_ready(s):
            rec.decode_stream(s)
        print(f"   {text:38s} -> {rec.get_result(s).strip().lower()}")
