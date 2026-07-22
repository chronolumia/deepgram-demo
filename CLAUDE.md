# CLAUDE.md — Repo Contract

Reference integration: **Deepgram** as the speech-to-text + audio-intelligence engine inside **DataVoice Inc.**'s customer-support call pipeline. DataVoice is migrating from a competitor, processes ~10,000 hours of recorded calls/month, and needs the output integrated into their existing CRM + analytics.

This file is the binding contract for how the repo is built. Follow it over habit or convention.

---

## 1. What we are building (and what we are not)

**We build:** a batch pipeline that takes recorded support calls, transcribes + enriches them with Deepgram, normalizes them into an engine-independent record, and publishes them to (mock) CRM + analytics sinks — plus a slim shadow-run validation view and a static dashboard.

**The demo through-line that MUST work end to end:** Stage 0 → 2 → 3 → 5 (a call is transcribed, normalized, lands in the mock CRM). Everything else makes it convincing or presentable, not functional.

### Non-goals (do NOT build these)
- **No Next.js. No frontend bundler/build step.** Plain Node backend + a static dashboard page.
- **No real database.** In-memory + JSON files on disk. Production persistence is *described* in the plan, not built.
- **No auth / RBAC / user management.**
- **No Voice Agent API, no telephony, no TTS.** Real-time agent-assist is an optional, clearly separated second act — not the core.
- **No custom Deepgram model training.** Terminology is handled via keyterm prompting; custom models are a documented Part-2 escalation only.
- **No real CRM.** A mock webhook endpoint stands in for it.
- Do not add edge-case handling that isn't on the through-line. "Water through pipes over coverage for every edge case."

---

## 2. Tech stack (fixed)

- **Runtime:** Node 20, **TypeScript** (strict).
- **Backend:** Express. Serves the static dashboard and a small API that triggers pipeline runs.
- **Deepgram:** the official **`@deepgram/sdk`** — used for STT (prerecorded), audio intelligence (Read), and, if the optional real-time slice is built, live. **Never hand-roll REST/WebSocket calls against Deepgram.**
- **Frontend:** one static HTML page + vanilla JS (React via CDN only if component structure is genuinely needed). No build step.
- **Optional LLM** (structured call summary): a single provider call behind one function; keep it swappable and off the critical path.

---

## 3. Code conventions

- **Comment design decisions, not obvious code.** A comment explains *why* a non-obvious choice was made (a Deepgram option, the normalization boundary, a trade-off) — never restates what the line already says. No comment on trivial lines.
- **One place per concern.** All Deepgram options live in the Deepgram wrapper. All destination logic lives behind the Sink interface. The `CallRecord` type is the single source of truth for the data contract.
- **TypeScript strict**, no `any` on public boundaries. Prefer small pure functions per stage.
- **No secrets in code.** Everything via env (`.env`, with `.env.example` committed).
- **Comments are written in English.** The repo is a customer-facing reference integration;
  mixed-language comments read as unfinished. The one exception is the temporary learning
  layer below.
- **Temporary learning comments** (`PROVENANCE`, `LERN-KONSTRUKT`, `ZWECK`) may be added
  freely while building, in any language, and are **stripped before the demo**. They are
  scaffolding, not documentation — never treat them as the explanation of a design decision.
- **Async errors must be reachable.** An `'error'` EVENT (streams, emitters) is not caught by
  `try/catch` and escapes as an uncaughtException. Convert it to a rejection at the boundary,
  or per-call error isolation is a fiction. This has already cost one crashed batch.

---

## 4. Inviolable product concepts

These two ideas are the reason the architecture exists. Do not erode them.

1. **Engine independence via the `CallRecord` contract.** Downstream systems (CRM, analytics) never see Deepgram's response shape — only our normalized `CallRecord`. This is what makes the vendor swappable without touching downstream, i.e. the technical answer to "minimal disruption." Stage 3 is the boundary; nothing Deepgram-specific may leak past it.

2. **Destinations behind one Sink abstraction.** Every output target implements the same `Sink` interface and is activated by config. Adding, removing, or traffic-splitting a destination must never require changes inside the pipeline stages.

---

## 5. The data contract — `CallRecord`

**`src/types/callRecord.ts` is the single source of truth. Read it there — it is not
reproduced here, because a second copy drifts.**

What must stay true of it, regardless of how it evolves:

- **Engine-independent.** No field may be named after, or shaped by, a Deepgram response.
  `processing.engine` names the engine as *data* precisely so swapping it is visible without
  changing the shape.
- **`schemaVersion` is bumped, never quietly reinterpreted.** Downstream consumers key off it.
- **`transcript` is already PII-redacted** when the record exists. Redaction happens in
  Stage 2, so no downstream component ever holds raw PII.
- **`error` is set instead of throwing.** A failed call is still a valid `CallRecord`, with
  the remaining fields best-effort. This is what keeps one bad call from ending a batch.
- **`validation` is optional** and present only when a shadow run actually happened.

## 6. The integration boundary — `Sink`

**`src/sinks/sink.ts` is the source of truth for the interface.** Two members: `name` and
`publish(record)`.

- `CrmWebhookSink` → POSTs the `CallRecord` to the mock CRM, with timeout, bounded retry on
  5xx/429, and a stable `Idempotency-Key` so a retry cannot duplicate a call.
- `AnalyticsSink` → upserts into a JSONL store by `callId`, so re-running a batch corrects
  records rather than duplicating them.
- `SplitSink` (`src/sinks/splitSink.ts`) wraps any sink and forwards a deterministic share of
  calls — this is the gradual-migration mechanism, and it is **built**.

`DESTINATIONS` selects and configures them: `DESTINATIONS=crm@25,analytics` sends a quarter
of calls to the CRM and everything to analytics. Routing is a deterministic hash of `callId`,
so a ramp is additive and a re-run routes identically.

**The rule that matters:** adding, removing, or traffic-splitting a destination must never
require an edit inside a pipeline stage. If it does, the abstraction has been eroded.

## 7. Deepgram usage rules

- All Deepgram access goes through **one thin wrapper**: `src/deepgram/client.ts`. It is the only file that imports `@deepgram/sdk` and the only place transcription options are set.
- **Batch/prerecorded** options (Stage 2): `model=nova-3`, `diarize`, `smart_format`, `redact`, `keyterm`, `language=en`.
- **Audio intelligence** (Stage 4): Deepgram Read for `summarize` / `topics`. Note: sentiment/intent are pre-recorded only — do not promise them live.
- **Exact SDK method names/namespaces are authoritative in the current `@deepgram/sdk` README** (`listen` / `read` / `speak` have shifted across versions). Match the installed version; do not guess from memory.
- Keep the keyterm list in `src/config/terms.json` so terminology is editable without code changes.

---

## 8. Folder structure

```
/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── server.ts              # Express: serves dashboard + API, triggers runs
│   ├── types/
│   │   └── callRecord.ts      # THE contract (Section 5)
│   ├── deepgram/
│   │   └── client.ts          # only file that touches @deepgram/sdk
│   ├── pipeline/
│   │   ├── ingest.ts          # Stage 0–1: read sample folder → jobs/queue
│   │   ├── transcribe.ts      # Stage 2: Deepgram prerecorded
│   │   ├── normalize.ts       # Stage 3 + 4: response → CallRecord (the boundary) + summary/topics
│   │   ├── validate.ts        # Stage 6: shadow-run + WER/term-recall
│   │   └── run.ts             # orchestrates stages per call + over a batch
│   ├── sinks/
│   │   ├── sink.ts            # Sink interface + DESTINATIONS registry (Section 6)
│   │   ├── crmWebhookSink.ts  # timeout + retry + idempotency key
│   │   ├── analyticsSink.ts   # JSONL store, upsert by callId
│   │   └── splitSink.ts       # traffic-split wrapper (gradual migration)
│   └── config/
│       └── terms.json         # keyterm list
├── public/
│   ├── index.html             # static dashboard, no build step
│   └── app.js
└── samples/                    # sample call audio + meta.json manifest
```

Stages map 1:1 to `src/pipeline/*`. If a file doesn't correspond to a stage or a boundary, question whether it belongs.

Tests live beside the code they cover as `*.test.ts` (`node --test`, no framework).
`tsconfig.build.json` keeps them out of `dist/`.

---

## 9. Pipeline stages (reference)

| Stage | Module | Responsibility |
|---|---|---|
| 0 Source | `ingest.ts` | discover sample audio + metadata |
| 1 Ingest/Queue | `ingest.ts` | one job per call; sequential by default, `CONCURRENCY` raises the pool |
| 2 Transcribe | `transcribe.ts` + `deepgram/client.ts` | Deepgram STT + redact + diarize + keyterm |
| 3 Normalize | `normalize.ts` | response → `CallRecord` (engine-independent boundary) |
| 4 Intelligence | `normalize.ts` | summary/topics → `CallRecord.intelligence` (merged in) |
| 5 Publish | `sinks/*` | `CallRecord` → CRM + analytics, optionally traffic-split |
| 6 Validate | `validate.ts` | Deepgram vs. baseline → `CallRecord.validation` (opt-in) |
| 7 Dashboard | `server.ts` + `public/*` | run overview, drill-down, WER delta, cost projection |

---

## 10. Environment

`.env.example` (committed):

```
DEEPGRAM_API_KEY=
PORT=3000
DESTINATIONS=crm,analytics        # "crm@25,analytics" traffic-splits the CRM
CRM_WEBHOOK_URL=http://localhost:3000/mock-crm
INTELLIGENCE_ENABLED=false        # Stage 4 — costs tokens
VALIDATION_ENABLED=false          # Stage 6 — costs a SECOND transcription per call
# CONCURRENCY=1                   # calls processed in parallel
# ANALYTICS_PATH=                 # override the analytics store location (tests)
# LLM_API_KEY=                    # optional, only if structured summary uses an LLM
```

---

## 11. Definition of Done (MVP)

Each item names how it is proven. A DoD nobody can run is a wish, not a gate — the
`npm start` path was broken for weeks precisely because nothing checked it.

| Done means | Proven by |
|---|---|
| Typecheck, lint, format and tests are green | `npm run verify` (also runs in CI) |
| The build produces a runnable server | `npm run build && npm start`, then `/health` |
| Triggering a run processes every call in `samples/meta.json` | `npm run dev` → "Run pipeline", or `POST /api/run` |
| Each call is transcribed (nova-3, redact, diarize, keyterm) and normalized to `CallRecord` | Dashboard rows with speaker-labelled, `[REDACTED]`-token transcripts |
| Records reach the mock CRM and the analytics store | `[crm] published …` in the log; `data/analytics.jsonl` |
| **A broken sample does not stop the batch** | `src/pipeline/transcribe.test.ts`, plus a bogus `meta.json` entry surviving a real run |
| **No Deepgram-specific shape appears downstream of `normalize.ts`** | `src/pipeline/normalize.test.ts` ("no Deepgram-shaped key survives the boundary") |
| Domain-term recall measures something rather than defaulting | Keyterms from `terms.json` actually present in the sample audio — not the vacuous `1.0` |

**Honesty gate.** Numbers shown to the customer must be reproducible and caveated where they
are weaker than they look: WER against a baseline tier is *disagreement*, not accuracy;
`costUsd` excludes the shadow-run pass; a recall of 100% is only meaningful if keyterms were
actually spoken. Never let a metric read stronger than its method supports.
