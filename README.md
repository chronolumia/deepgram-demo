# DataVoice × Deepgram — reference integration

A batch pipeline that transcribes recorded customer-support calls with Deepgram, enriches
them, normalizes them into an **engine-independent `CallRecord`**, and publishes them to a
mock CRM and an analytics store — plus a shadow-run accuracy check and a static dashboard.

It exists to answer one question concretely: *can DataVoice swap its speech-to-text vendor
without its CRM and analytics noticing?* The two ideas that make the answer "yes" are the
`CallRecord` boundary (`src/pipeline/normalize.ts`) and the `Sink` interface
(`src/sinks/sink.ts`). Everything else is scaffolding around those two.

The binding build contract is [CLAUDE.md](CLAUDE.md). The accuracy methodology is
[VALIDATION.md](VALIDATION.md). The customer-facing walkthrough is
[docs/kickoff-technical-brief.html](docs/kickoff-technical-brief.html).

---

## Quick start

Requires **Node 20+** and a Deepgram API key.

```bash
npm install
cp .env.example .env      # then paste your DEEPGRAM_API_KEY into .env
npm run dev               # http://localhost:3000
```

Open the dashboard and click **Run pipeline**. It processes every call listed in
`samples/meta.json` and renders one row per call, each expandable to show the
speaker-labelled, PII-redacted transcript.

Headless equivalent:

```bash
curl -s -X POST http://localhost:3000/api/run | jq '.records[] | {callId, error, wer: .validation.wer}'
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server with hot reload (tsx). The normal way to run the demo. |
| `npm test` | Unit tests: WER math, keyterm matcher, Stage 3 boundary, sink resolution, per-call error isolation. No API key or network needed. |
| `npm run typecheck` | `tsc --noEmit`, including tests. |
| `npm run lint` | ESLint (type-aware). |
| `npm run format` / `format:check` | Prettier. |
| `npm run verify` | typecheck + lint + format check + tests. What CI runs. |
| `npm run build` | Compiles to `dist/` via `tsconfig.build.json` (tests excluded). |
| `npm start` | Runs the compiled `dist/server.js`. Run `npm run build` first. |
| `npm run hello` | One-shot SDK smoke test against a hosted clip — checks key + connectivity. |

## Configuration

All config is env-based; see [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `DEEPGRAM_API_KEY` | — | Required. Read by the SDK in `src/deepgram/client.ts`. |
| `PORT` | `3000` | Server port. |
| `DESTINATIONS` | `crm,analytics` | Which sinks are active, and their traffic share — `crm@25,analytics`. Unknown names fail fast. |
| `CRM_WEBHOOK_URL` | `http://localhost:3000/mock-crm` | Where `CrmWebhookSink` POSTs each `CallRecord`. |
| `INTELLIGENCE_ENABLED` | `false` | Stage 4 — Deepgram Read summary + topics. |
| `VALIDATION_ENABLED` | `false` | Stage 6 — shadow run. **Costs a second full transcription per call.** |
| `CONCURRENCY` | `1` | Calls processed in parallel. Sequential by default. |
| `ANALYTICS_PATH` | `data/analytics.jsonl` | Where the analytics store is written. |

> Both `INTELLIGENCE_ENABLED` and `VALIDATION_ENABLED` are opt-in because each one adds
> cost per call. Set `VALIDATION_ENABLED=true` to populate the dashboard's WER and
> domain-recall columns.

---

## Pipeline stages

Stages map 1:1 onto `src/pipeline/*`.

| Stage | Module | Responsibility | Status |
|---|---|---|---|
| 0 Source | `ingest.ts` | Discover sample audio + metadata from `samples/meta.json` | ✅ built |
| 1 Ingest / Queue | `ingest.ts` | One job per call; sequential by default, `CONCURRENCY` raises the pool | ✅ built |
| 2 Transcribe | `transcribe.ts` + `deepgram/client.ts` | Deepgram STT — nova-3, diarize, smart_format, redact, keyterm | ✅ built |
| 3 Normalize | `normalize.ts` | Response → `CallRecord`; **the engine-independence boundary** | ✅ built |
| 4 Intelligence | `normalize.ts` | Summary + topics merged into `CallRecord.intelligence` | ✅ built, opt-in |
| 5 Publish | `sinks/*` | `CallRecord` → mock CRM + analytics JSONL, traffic-split capable | ✅ built |
| 6 Validate | `validate.ts` | Shadow run vs. baseline model → WER + domain-term recall | ✅ built, opt-in |
| 7 Dashboard | `server.ts` + `public/*` | Run overview, drill-down, cost projection | ✅ built |

**Not built (deliberately):** real persistence (JSON on disk stands in for a database and a
warehouse), auth/RBAC, live/streaming transcription, custom model training. See CLAUDE.md §1
for the non-goals and `docs/kickoff-technical-brief.html` §08 for what production would add.

## Gradual migration — the traffic split

`DESTINATIONS=crm@25,analytics` routes a quarter of calls to the CRM and all of them to
analytics. Ramping a migration is one env change:

```
crm@5  →  crm@25  →  crm@50  →  crm        # rollback is setting the number back
```

Routing is a deterministic hash of `callId`, not a coin flip. That buys three things a random
sample would not: a re-run routes every call the same way (so a retry cannot double-publish),
raising the share is purely additive (a call in the 5% cohort stays in the 25% cohort), and a
demo produces the same split twice in a row. `SplitSink` wraps *any* sink, so no pipeline
stage knows a split is happening — which is the point of the `Sink` interface.

## Sample audio

`samples/meta.json` is the source of truth for what gets processed — `ingest.ts` reads it
and ignores anything not listed. It currently points at four scripted DataVoice support
calls (`call-004`–`call-007`), recorded from `samples/call-scripts.md`.

Those scripts deliberately plant vocabulary from `src/config/terms.json` — plus
**QuantaFlow**, an invented product name Nova-3 has never seen — so keyterm prompting can
be demonstrated honestly: run once with the keyterm list and once without, and compare
domain-term recall on the same audio.

The original `call-001`–`call-003` `.wav` files were Deepgram's own public sample clips and
have been removed. They contained none of DataVoice's vocabulary, which made domain-term
recall report a meaningless 100% on every call. See VALIDATION.md §4.

To add a call: drop the file in `samples/`, add an entry to `samples/meta.json`. No code
changes.

## Architecture notes

- **`src/deepgram/client.ts` is the only file that imports `@deepgram/sdk`**, and the only
  place transcription options are set. A vendor swap touches one file.
- **Nothing Deepgram-shaped crosses `normalize.ts`.** Sinks and the dashboard only ever see
  `CallRecord` (`src/types/callRecord.ts`), which is the single source of truth for the data
  contract. `src/pipeline/normalize.test.ts` asserts this.
- **Failure is per-call, not per-batch.** A call that throws becomes a valid `CallRecord`
  with `error` set, so one bad file never stops the run. A sink that throws is logged and
  the batch continues. Audio is opened through `transcribeLocalFile`, which converts
  filesystem stream errors into rejections — otherwise they surface as uncaught exceptions
  and kill the process mid-batch (`src/pipeline/transcribe.test.ts` guards this).
- **PII is redacted by Deepgram in Stage 2**, before a `CallRecord` exists — so no
  downstream component ever holds the raw transcript.

## Known limitations

- Speaker roles use a heuristic — whoever speaks first is the agent. It inverts for the
  whole call if the customer opens. See the comment on `roleForSpeaker` in `normalize.ts`.
- WER is measured against a weaker Deepgram tier, not ground truth. It measures
  disagreement, not accuracy — VALIDATION.md §3 explains what it is and isn't good for.
- `costUsd` covers the primary transcription pass only. The shadow-run pass is real spend but
  is excluded, because Deepgram no longer publishes the legacy tier's rate — the dashboard
  states this rather than guessing a number.
- `AnalyticsSink` rewrites the whole JSONL file per record to upsert by `callId`. Correct and
  fine for a demo batch; it is O(n²) and the first thing to replace with a real datastore.
- The mock CRM accepts an `Idempotency-Key` header but does not actually dedupe on it — a
  real CRM would.
