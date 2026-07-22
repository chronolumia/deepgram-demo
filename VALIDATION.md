# Validation Methodology

How we'd confirm — not just claim — that Deepgram is more accurate than the
incumbent vendor, before and during the migration. This answers one of the
five core requirements from the brief ("Validation methodology to confirm
accuracy improvements").

**What is built vs. what is method.** A slim shadow run *is* implemented —
`src/pipeline/validate.ts` re-transcribes each call against a weaker Deepgram
tier and fills `CallRecord.validation` with a WER and a domain-term recall
figure. It is opt-in behind `VALIDATION_ENABLED`, because it costs a second
full transcription of every call. Everything else below — ground-truth eval
sets, distribution reporting, acceptance thresholds — is methodology for the
real migration, not code in this repo. Section 3 is the important one: it
says plainly what the number `validate.ts` produces can and cannot support.

This is grounded in Deepgram's own published guidance
([Measuring Quality: WER Explained](https://deepgram.com/learn/measuring-quality-word-error-rate-explained),
[Lies, Damn Lies, and Benchmarks](https://deepgram.com/learn/lies-damn-lies-and-benchmarks),
[Speech Recognition Accuracy: Production Metrics](https://deepgram.com/learn/speech-recognition-accuracy-production-metrics)),
not invented from scratch — where our plan deviates from their guidance, that's called out explicitly below.

---

## 1. Metrics

**Word Error Rate (WER)** — Deepgram's own formula, which we adopt as-is:

```
WER = (Insertions + Deletions + Substitutions) / words in ground-truth transcript
```

All three error types are weighted equally. Deepgram provides a reference
Python implementation (Levenshtein-style alignment + backtrace) in the article
above; `CallRecord.validation.wer` in our schema is designed to hold exactly
this number per call.

**Domain-Term-Recall** — Deepgram's own caveat is that WER alone is
insufficient; they explicitly recommend checking accuracy on
vocabulary specific to the use case. For a support-call pipeline, a missed
product name or plan tier is more costly than a missed filler word, so this
metric sits alongside WER, not beneath it. Computed as: (keyterms correctly
recognized) / (keyterms actually present in the ground truth), against the
same list already used for keyterm prompting (`src/config/terms.json`).

**Distribution, not just an average** — Deepgram's benchmarking guidance
specifically warns against reporting a single mean WER, and recommends box
plots (min / Q1 / median / Q3 / max) so outliers — the 2% of calls with bad
line quality or heavy cross-talk — don't hide inside a flattering average.

**Consistent normalization before comparing** — capitalization, punctuation,
and filler-word handling must be normalized the same way across both engines
before diffing, or the two engines get penalized for stylistic differences
that have nothing to do with actual recognition accuracy.

---

## 2. Baseline choice

The reference plan allows either option; we'd pick based on what's available
at Discovery time (Phase 0):

- **A second, weaker Deepgram model tier as a stand-in for "the old engine"**
  — fast to run, same API, no separate vendor contract needed to test with.
  Reasonable for illustrating the *mechanism* of a shadow-run, weaker as a
  literal stand-in for the incumbent's actual behavior.
- **A human-labeled ground-truth subset** — the harder-to-get but more
  honest option. Deepgram's own guidance is explicit that the incumbent
  vendor's output should never be treated as truth either — it has its own
  errors — so ground truth (or the second-tier stand-in) is compared against
  *both* Deepgram and the incumbent, not Deepgram against the incumbent
  directly.

**In production, the real incumbent vendor's live output is the actual
baseline** — the calls already produce it today. The question during
Discovery is just how much of that we can access historically to build the
eval set.

---

## 3. What a baseline-only WER can (and can't) tell you

Worth stating plainly rather than implying more than is true: comparing
Deepgram against a weaker Deepgram tier (or, in production, against the
incumbent vendor directly) tells you **how much the two disagree**, not
**which one is correct**. Two transcripts that score a low WER apart could
both be wrong in the same spot; two that score a high WER apart could differ
because exactly one of them got a proper noun right and the other didn't.
Without a ground-truth reference, a baseline-only WER cannot by itself be
reported as "Deepgram improved accuracy by X%" — that would be an overclaim
this methodology should catch, not make.

What it's legitimately good for instead:

- **Drift/regression detection over time.** The delta between Deepgram and
  the baseline tier should stay roughly stable call after call. If it
  suddenly jumps for a batch, that's a real, actionable signal — new audio
  characteristics, a silent Deepgram model update, or a regression in our own
  pipeline config — even though it doesn't reveal *which side* moved.
- **A cheap triage filter for human review.** Diffing two transcripts costs
  nothing; having a human re-listen to hours of audio from scratch is
  expensive. The specific words where Deepgram and the baseline disagree —
  typically a small fraction of the total — are exactly the set worth a
  human adjudicating ("which one actually said it right here?"), instead of
  transcribing an entire eval set from zero. This is the realistic bridge
  between what `validate.ts` computes today and the ground-truth comparison
  in Section 2.

**The actual regression-vs-improvement verdict still requires one of:** a
human-labeled ground-truth subset (Section 2's second option), scored
independently against both Deepgram and the incumbent; or human adjudication
specifically on the disagreements the baseline diff surfaces.
`CallRecord.validation.wer` as computed today is the *diff*, not the verdict.

---

## 4. What our sample audio can and can't support

Deepgram's own benchmarking guidance says to test with **your own real-world
data**, not vendor-supplied sample clips, and explicitly warns that public
benchmark audio may already be in a vendor's training data.

The pipeline originally ran against three of Deepgram's own hosted example
clips — exactly the audio that guidance advises against, and worse, audio
containing none of DataVoice's vocabulary, which made domain-term recall
report a meaningless 100% on every call. `samples/meta.json` now points at
the four scripted support calls recorded for this demo (see
`samples/call-scripts.md` and README's "Sample audio" section), so keyterm
recall, diarization and redaction are measured against speech that actually
contains the terms in `src/config/terms.json`.

That makes the *demo* honest, not the *validation* complete. These recordings
are still scripted and clean — no background noise, no cross-talk, no accent
spread. They prove the mechanics work end to end. A real accuracy verdict
needs the eval set described in Sections 2 and 5: authentic, messy,
production-representative calls, human-labeled.

---

## 5. Eval-set sizing

Per Deepgram's own guidance: **minimum ~10,000 words (~1 hour) per condition**
— "condition" meaning a distinct combination of accent, audio quality, and
call topic that shows up in the real 10k h/month volume. A representative
eval set samples across those conditions rather than picking 1 hour at random.

---

## 6. What happens when this goes to production

Validation isn't a one-time gate before cutover — it's a continuous check
across the whole 60-day rollout (see `docs/kickoff-technical-brief.html` §05
"Five phases to cutover" for the customer-facing version of this plan):

| Phase | Validation activity |
|---|---|
| **0 · Discovery (Day 0–7)** | Build the eval set (own real audio, sized per Section 5 above); decide the baseline (Section 2); capture the incumbent's current WER as the number to beat; define acceptance thresholds *before* any ramp starts. |
| **1 · Integration-Build (Day 7–21)** | Wire `CallRecord.validation` end-to-end so every call in the pipeline — not just the eval set — carries a WER/recall figure once shadow-run is live. |
| **2 · Shadow/Parallel (Day 21–40)** | Deepgram runs on 100% of calls in shadow (output discarded, not yet delivered to CRM); daily WER-delta + domain-term-recall monitoring against the acceptance thresholds; keyterm list gets tuned based on what's actually missed. Zero customer-facing impact — this phase exists specifically so a bad result costs nothing. |
| **3 · Gradual Cutover (Day 40–55)** | Traffic ramps 5% → 25% → 50% → 100% via the same `DESTINATIONS`-style feature flag already in the codebase. Each step only proceeds if the prior step's metrics stay within threshold; rollback is just flipping the flag back, no data migration to undo. |
| **4 · Full Operation (Day 55–60)** | Incumbent vendor decommissioned. Validation becomes standing operations: continuous accuracy monitoring, alerting on regression, not a project artifact anymore. |

The acceptance thresholds themselves (e.g. "Deepgram WER must be ≤ incumbent
WER" or "domain-term-recall must exceed X%") are a business decision made
with the customer at the end of Phase 0 — this document defines how they'd be
measured, not what the specific numbers should be.
