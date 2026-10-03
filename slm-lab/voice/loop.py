# Voice loop: speech -> Parakeet v3 (int8) -> Gemma-3-270M-QAT on our Zig engine -> Supertonic 3 -> speech
import time, subprocess, re, numpy as np, soundfile as sf, onnx_asr
from scipy.signal import resample_poly
from tokenizers import Tokenizer
from supertonic import TTS

tk = Tokenizer.from_file('hfg/tokenizer.json')
t0 = time.time(); asr = onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v3', 'voice/parakeet-v3', quantization='int8'); t_asr_load = time.time() - t0
t0 = time.time(); tts = TTS(auto_download=True); t_tts_load = time.time() - t0
print(f'loads: parakeet {t_asr_load:.1f}s, supertonic {t_tts_load:.1f}s')

def to16k(path):
    w, sr = sf.read(path); w = w if w.ndim == 1 else w.mean(1)
    return resample_poly(w, 160, sr // 100 if sr % 100 == 0 else sr).astype(np.float32) if sr != 16000 else w.astype(np.float32)

def stt(path):
    w = to16k(path); sf.write('voice/_in16k.wav', w, 16000)
    t = time.time(); txt = asr.recognize('voice/_in16k.wav'); return txt, time.time() - t, len(w) / 16000

def speak(text, path, voice):
    t = time.time(); wav, dur = tts.synthesize(text, voice_style=tts.get_voice_style(voice_name=voice), lang='en')
    tts.save_audio(wav, path); return time.time() - t, float(np.asarray(dur).ravel()[0])

for qi, (question, qvoice, avoice) in enumerate([
        ("What is the capital of France, and why is it famous?", "F1", "M1"),
        ("Give me one simple tip for sleeping better tonight.", "M2", "F2")]):
    qpath = f'voice/q{qi}.wav'; speak(question, qpath, qvoice)              # make the spoken question
    heard, t_stt, qdur = stt(qpath)
    ids = tk.encode(f"<start_of_turn>user\n{heard}<end_of_turn>\n<start_of_turn>model\n").ids
    open('prompt_ids.txt', 'w').write(','.join(map(str, ids)))
    t = time.time(); out = subprocess.run(['./gri', 'qat', 'gen'], capture_output=True, text=True).stderr; t_llm_wall = time.time() - t
    timing = re.search(r'TIMING (.*)', out).group(1)
    oid = [int(x) for x in re.search(r'OUT:(.*)', out).group(1).split()]
    answer = tk.decode(oid).strip()
    apath = f'voice/a{qi}.wav'; t_tts, adur = speak(answer, apath, avoice)
    back, _, _ = stt(apath)
    print(f'\n[{qi}] spoken question ({qdur:.1f}s, voice {qvoice}) -> Parakeet heard: {heard!r}  [{t_stt*1000:.0f} ms]')
    print(f'    engine: {timing}  | process wall incl. load {t_llm_wall*1000:.0f} ms')
    print(f'    answer: {answer!r}')
    print(f'    Supertonic 3: {adur:.1f}s of speech in {t_tts*1000:.0f} ms (RTF {t_tts/adur:.2f}), voice {avoice}')
    print(f'    round-trip check, Parakeet on the spoken answer: {back!r}')
