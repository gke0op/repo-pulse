# Is the base saturated? Chinchilla continuation probes (2026-10-04)

Question: train `hybrid19` (18.5M) toward Chinchilla-optimal (~20 tokens/param ≈ 370M tokens; the base saw 189M)
and report the losses; innovate if the gains disappoint. Run in the cloud VM (2 cores, AMX bf16), scratch trainer
mirroring `train.py` (same model, Muon + AdamW, mix, loss, and the same fixed validation batches recipe), but with a
token budget and resumable chunks. Data re-encoded with the **existing** `orb.model` (no tokenizer retrain):
stories 184.7M, SODA 75.7M, dialogues 41.0M train tokens. All numbers **measured** unless marked.

## Speed (measured, this VM)
| | tok/s |
|---|---|
| fp32 | 897 |
| bf16 autocast (AMX) | 1,820 |
| bf16 + `torch.compile` | **3,081** (4,600 with the CPU otherwise idle) |
`RESEARCH.md` found no gain from compile on the Mac; on this Linux VM it is 1.7×. 181M more tokens ≈ 11–20 h here.

## Validation loss (lower is better)
| Run | Total tokens | stories | SODA | dialogues |
|---|---|---|---|---|
| **base** (`hybrid19-base-bf16.pt`) | 189M | **1.794** | 1.528 | 1.271 |
| A: re-warm to ½ peak LR, same mix, at 6M | 195M | 1.835 | 1.573 | 1.308 |
| A: same, at 12M | 201M | 1.837 | 1.573 | 1.311 |
| A: branch at 13.9M, linear decay to 0 over 6M | 209M | 1.815 | 1.551 | 1.287 |
| B: gentle (⅕ peak), same mix, warmup-stable-decay, 6M | 195M | 1.796 | 1.531 | 1.272 |
| **C: gentle, dialogue-weighted mix (stories .2 / SODA .5 / dialogues .3), 6M** | 195M | 1.809 | **1.523** | **1.262** |

Each validation number averages 12 batches (~98k tokens); differences under ~0.005 are noise (inferred).

## What it says
- **On the original mix the base is effectively saturated.** Re-warming to half the peak learning rate costs
  +0.04 and decaying only wins back half of it (A). A gentle continuation that doesn't disturb the minimum ties
  the base (B). Neither shows the data term still paying at this size. Consistent with `RESEARCH.md`'s choice of
  ~8 tokens/param as compute-optimal (nanochat): at 10 tokens/param the base is already past that point.
- **Inferred (scaling-law shape, not measured):** finishing all 181M tokens on the same mix would likely
  gain < 0.02 per set, for 11–20 h of CPU. Underwhelming, so not run.
- **The innovation that works: spend the fixed capacity where the orb talks.** Re-weighting toward dialogue (C)
  is the only continuation that beats the base anywhere: SODA −0.005, dialogues −0.009, stories +0.015 (the orb
  doesn't tell stories).

## Downstream: does the voice care? (measured)
Same voice fine-tune (all 50k lines, 300 steps, fixed 2,000-line held-out set, `notes/listen-2026-10-04.md` setup):

| Voice fine-tuned on | Held-out voice loss | Right tool (60 become rows) |
|---|---|---|
| base | 2.537 | 43/60 |
| **C (dialogue-weighted, +6M tokens)** | **2.480** | **46/60** |

0.057 lower voice loss from a 6M-token continuation, 6–10× larger than the pretraining deltas that produced it.
The tool difference is within noise for 60 samples.

## Next
1. Scale C: the same dialogue-weighted gentle continuation for ~60M tokens, checking whether the voice gain grows
   (running next in the VM, logged to `runs/chin-dialogue/`).
2. Add learning-rate decay to `voice.py` (see the listen note): with a constant LR every voice run drifts after
   ~300 steps, which also hides how much the voice data helps.
3. If C keeps paying, retrain the base from scratch with the dialogue-heavy mix (a trainer-seat decision).
