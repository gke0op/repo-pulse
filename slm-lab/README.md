# slm-lab — a from-scratch small-LM engine in Zig, measured against llama.cpp

A lab notebook in code: decoder engines for **SmolLM2-135M** and **Gemma 3 270M** (incl. Google's QAT Q4_0),
written in Zig 0.17 on AVX-512 VNNI, plus the accuracy studies, bound studies and a voice loop
(Parakeet 0.6B v3 → engine → Supertonic 3). Every number below was measured on a 2-vCPU Emerald Rapids VM
(260 MB L3, ~25 GB/s DRAM) and compared to llama.cpp on the same files, alternating runs because the VM is noisy.

> Status: research harness, x86 only (AVX-512 VNNI). The ARM/NEON port for phones is the next step (see end).

## Quick start

```bash
slm-lab/scripts/setup.sh            # Zig 0.17, llama.cpp, models, conversions, builds -> slm-lab/work/
cd slm-lab/work
./gri qat pp                        # batched prefill vs sequential (64/256/512-token prompts)
cp gprompt.txt prompt_ids.txt && ./gri qat gen    # one chat turn: prompt ids in, answer ids + timings out
./gri qat casc check                # cascade head with every token checked against the full head
./gspec qat                         # speculative (prompt-lookup) vs greedy on a story and an edit task
./sun                               # SmolLM2-135M Q8 engine (./sun mix = mixed Q8/Q4)
python3 voice/loop.py               # voice loop (needs: pip install onnx-asr onnxruntime supertonic soundfile)
```
`voice/loop.py` expects the Parakeet ONNX export in `work/voice/parakeet-v3`
(`huggingface_hub.snapshot_download('istupakov/parakeet-tdt-0.6b-v3-onnx', local_dir='voice/parakeet-v3')` —
a plain local copy; onnxruntime 1.29 rejects the HF-cache symlink for the fp32 external-data file).

## Layout

| Path | What |
|---|---|
| `engine/gri.zig` | Gemma 3 270M engine (current): row-interleaved Q8/Q4 kernels, batched prefill, vocab-head bit-plane cascade, speculative decoding hooks. Flags: `qat`, `casc`, `check`, `pp`, `gen` |
| `engine/gemma.zig` | Gemma per-row baseline (first port) |
| `engine/sun.zig` | SmolLM2-135M engine (Q8, or `mix` = activation-aware Q4 + Q8) |
| `engine/gspec.zig` | speculative-vs-greedy harness (generated from `gri.zig`) |
| `bench/` | kernel microbenches (`q8v`, `q4v`, `big`, `ri`, `ri4`) and bandwidth probes (`bw.c`, `bw2.c`) |
| `py/gemma.py` | Gemma converter (`convert`, `convert_ri`) + independent NumPy reference (`ref`) |
| `py/convert.py`, `py/ref.py` | SmolLM converter + NumPy reference |
| `py/qexp.py`, `py/awq.py`, `py/conv_mix.py`, `py/gq.py`, `py/awq_core.py` | 4-bit accuracy studies (KL vs Q8) and the mixed-precision converter |
| `py/headprobe*.py`, `py/bound.py`, `py/sbound.py`, `py/coarse2.py`, `py/clus.py` | vocab-head cascade feasibility studies |
| `py/fftprobe.py` | spectral-structure probe (FFT/DCT) on weights and hidden states |
| `py/mkprof.py`, `py/mkeval.py` | generate profiling / evaluation variants of an engine |
| `voice/loop.py` | Parakeet v3 → engine → Supertonic 3 voice loop |
| `data/` | token-id fixtures (prompts, calibration text, eval text) |

## Results

### SmolLM2-135M (fits in the 260 MB L3, so these are cache-speed numbers)
| | llama.cpp | ours |
|---|---|---|
| Q8 decode, 2 threads | 159–168 tok/s | 184–206 tok/s (median) |
| ~106 MB 4-bit-class | Q4_K_M 137–146 tok/s, KL 0.025 | mix (Q8 embd/v/k/down + AWQ-Q4) ~225 tok/s, KL 0.034–0.040 |

Correctness: argmax 16/16 vs an independent NumPy reference, logit corr ≥ 0.998.

### Gemma 3 270M QAT Q4_0 (the head alone is 178 MB of 235 MB)
| | llama.cpp | ours |
|---|---|---|
| decode, 400-token story | 131–143 tok/s (tg64 @ ctx 230) | **175–180 tok/s** (cascade head) |
| prompt prefill, 64–512 tokens | ~1000–1270 tok/s | **~1175–1430 tok/s** |
| "fix the typos" edit, speculative | — (plain decode 131–143) | **390–425 tok/s**, output identical to greedy |

Correctness: engine vs NumPy reference of the same file: argmax 15/16, mean corr 0.998; the NumPy reference
itself matches HF transformers at 16/16 positions.

### Voice loop (warm, this VM)
| stage | turn 1 | turn 2 |
|---|---|---|
| Parakeet 0.6B v3 int8 (ONNX) | 513 ms, exact | 530 ms, exact |
| our engine: prefill + decode | 26 + 64 ms | 29 + 62 ms |
| Supertonic 3 | 1094 ms (RTF 0.45) | 705 ms (RTF 0.38) |

Footprints: Parakeet encoder int8 652 MB, Supertonic 3 380 MB, Gemma 270M QAT 235 MB.

## What made the difference
- **Repacked layout + VNNI**: 64B-aligned int8 rows + separate f16 scales; `vpdpbusd` with an XOR-0x80 / bias trick.
- **Row-interleaved (16-row) kernels**: one VNNI op advances 16 rows against a broadcast 4-byte slice of x; per-block
  float work is amortised over 16 rows and there is no horizontal reduce. Made 4-bit 1.6× faster than 8-bit per
  weight in cache. (ARM `sdot` with lane-indexed broadcast has the same shape.)
- **Vocab-head bit-plane cascade**: q = 16·hi + lo. Pass 1 reads only the hi nibbles (≈ half the head bytes) and
  computes a coarse score plus a per-row σ for the unread bits; rows within 7σ of the best lower bound are rescored
  in Q8. 0 mismatches vs the full head over every check (largest error seen in 46.7 M samples: 5.44σ). This is a
  data-calibrated statistical guarantee, not a proof; the strict worst-case bound prunes nothing (≈26× loose).
- **Attention**: GQA/MQA row reuse, both threads (flash-decoding merge), f16 KV, K stored in 16-position tiles.
- **Batched prefill** (8 tokens per weight pass) and **speculative decoding** (prompt-lookup drafts, verification with
  decode-identical attention numerics, batched cascade head, adaptive length + miss backoff).

## Things that did not work (measured)
- Block-64 Hadamard rotation before 4-bit rounding (worse KL on SmolLM).
- Coarser 4-bit scales for the head plane (G=128 or per-row): candidates explode.
- Clustering the vocabulary (k-means, K=1024): rows sit ~78% of their norm from their centroid; ~97% of rows still read.
- 4-row unrolling of the per-row Q8 kernel (Q8 was already at the L3 bandwidth ceiling).
- FFT/DCT compression of weights or hidden dimensions: indistinguishable from a shuffled control (no spectral
  structure). Mild structure exists only along the time axis.
- Plain post-training 4-bit on Gemma: one tensor class alone costs KL 0.07–0.39 (hence the QAT checkpoint).

## Bugs worth remembering
- `@min(V, x)` with a comptime-known `V` returns a narrowed integer type in Zig; with V = 262144 the row index became
  a u19 and overflowed. ReleaseFast turned that into silent masking; a ReleaseSafe build pinpointed it.
- Copying a 1 KB `[N]V16f` through `@bitCast` into an array in the attention hot path cost ~9 µs per copy
  (~37 µs per call); storing each 16-lane slice directly removed it.
- This VM's 260 MB L3 holds the whole 135M model, so early "memory wall" numbers were cache numbers; the 1 GB
  kernel tests are the honest DRAM ones (Q8 at ~81% of DRAM bandwidth, Q4 1.75× faster than Q8 there).

## For the companion app
The app runs llama.cpp (KleidiAI) with Gemma 3 4B Q4_K_M, Parakeet 0.6B v2 (sherpa-onnx) and Supertonic 3. Ideas that
transfer without adopting this engine:
1. **Gemma 3 270M as a speculative draft for Gemma 3 4B** (same tokenizer); llama.cpp supports draft models.
2. **Prompt-lookup speculation** for repeat-heavy replies (edits, quotes, summaries): 2.1–2.3× here, exact output.
3. **KV-prefix reuse + batched prefill** for the roadmap's "start the brain at the first pause" plan.
4. **Vocab-head cascade**: Gemma 3 4B's tied 262k × 2560 head is ~16% of its weights.

## Next
Port the row-interleaved kernels to NEON `sdot` (Zig cross-compiles to aarch64-linux-android), build one static
binary, and measure Q8 vs QAT-Q4 vs cascade on the phone, where the memory wall is real.
