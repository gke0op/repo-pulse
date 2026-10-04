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

## Scaled: dialogue-weighted continuation to 60M tokens (measured)

Gentle LR (1/5 of the original peak), mix stories .2 / SODA .5 / dialogues .3, warmup 2%, stable, linear decay over the last 30% (from 42M). 249M total tokens (~13.5 tokens/param).

| Extra tokens | LR × | stories | SODA | dialogues |
|---|---|---|---|---|
| 0M | — | 1.794 | 1.528 | 1.270 |
| 6M | 1.0 | 1.815 | 1.529 | 1.266 |
| 12M | 1.0 | 1.820 | 1.521 | 1.260 |
| 18M | 1.0 | 1.822 | 1.515 | 1.252 |
| 24M | 1.0 | 1.825 | 1.509 | 1.247 |
| 30M | 1.0 | 1.826 | 1.505 | 1.243 |
| 36M | 1.0 | 1.828 | 1.500 | 1.240 |
| 42M | 1.0 | 1.829 | 1.497 | 1.232 |
| 48M | 0.686 | 1.826 | 1.488 | 1.227 |
| 54M | 0.353 | 1.819 | 1.480 | 1.219 |
| 60M | 0.02 | 1.814 | 1.474 | 1.214 |

**Final vs base:** stories +0.020, SODA **−0.054**, dialogues **−0.057**. The dialogue sets kept improving through the
stable phase (unlike the original-mix continuation, which never beat the base) and the decay added about a third of
the total gain.

**Voice on top (same 300-step fine-tune, fixed 2,000-line held-out set):**

| Voice fine-tuned on | Held-out voice loss | Right tool |
|---|---|---|
| base (189M) | 2.537 | 43/60 |
| + 6M dialogue-weighted | 2.480 | 46/60 |
| **+ 60M dialogue-weighted** | **2.469** | **48/60** |

**Reading it (inferred):** 10× more continuation buys only 0.011 more voice loss on top of the first 6M, even though
pretraining loss on dialogue kept falling 6×. The voice benefits from the *direction* (toward conversation) far more
than from the *amount*. For this 18.5M model that points to the next lever being the voice recipe itself (LR decay in
`voice.py`) and data shape, not more pretraining tokens.

**Weights (not in git):** `runs/chin-dialogue/base-dialogue60.pt` (bf16, 37 MB) in the cloud VM; ask to have it
copied to the Mac if the trainer seat wants to try it in `voice.py`.
