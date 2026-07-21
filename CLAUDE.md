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

---

## 4. Inviolable product concepts

These two ideas are the reason the architecture exists. Do not erode them.

1. **Engine independence via the `CallRecord` contract.** Downstream systems (CRM, analytics) never see Deepgram's response shape — only our normalized `CallRecord`. This is what makes the vendor swappable without touching downstream, i.e. the technical answer to "minimal disruption." Stage 3 is the boundary; nothing Deepgram-specific may leak past it.

2. **Destinations behind one Sink abstraction.** Every output target implements the same `Sink` interface and is activated by config. Adding, removing, or traffic-splitting a destination must never require changes inside the pipeline stages.

---

## 5. The data contract — `CallRecord`

`src/types/callRecord.ts` is the single source of truth. Keep it engine-independent.

```typescript
export type SpeakerRole = "agent" | "customer" | "unknown";

export interface TranscriptSegment {
  speaker: SpeakerRole;
  startSec: number;
  endSec: number;
  text: string; // already PII-redacted by Stage 2
}

export interface CallIntelligence {
  summary?: string;
  topics?: string[];
  // Extension point: intent, QA scorecard, sentiment (all Part-2 / post-call).
}

export interface ValidationResult {
  baselineLabel: string;   // what Deepgram was compared against
  wer: number;             // word error rate, Deepgram vs. baseline
  domainTermRecall: number; // recall on the keyterm list (often > WER in value)
}

export interface CallRecord {
  callId: string;
  source: {
    audioUri: string;
    startedAt: string;     // ISO-8601
    durationSec: number;
    agentId?: string;
  };
  transcript: {
    segments: TranscriptSegment[];
    redactedText: string;  // full flat transcript, PII-redacted
  };
  intelligence: CallIntelligence;
  validation?: ValidationResult; // present only when shadow-run ran
  processing: {
    engine: "deepgram";    // explicit, so swappability is visible in the data
    model: string;         // e.g. "nova-3"
    processedAt: string;   // ISO-8601
    costUsd?: number;
  };
  error?: string;          // set if this call failed; other fields best-effort
  schemaVersion: 1;
}
```

---

## 6. The integration boundary — `Sink`

`src/sinks/sink.ts`. Destinations are registered and activated by the `DESTINATIONS` env var.

```typescript
import type { CallRecord } from "../types/callRecord";

export interface Sink {
  readonly name: string;               // e.g. "crm", "analytics"
  publish(record: CallRecord): Promise<void>;
}
```

- `CrmWebhookSink` → POST the `CallRecord` to the mock CRM endpoint; surface the ack.
- `AnalyticsSink` → append to a JSON/CSV store.
- A registry maps names → instances; `DESTINATIONS=crm,analytics` selects which run. A traffic-split parameter (share of calls routed to Deepgram output) enables the gradual-migration story.

---

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
│   │   ├── sink.ts            # Sink interface (Section 6)
│   │   ├── crmWebhookSink.ts
│   │   └── analyticsSink.ts
│   └── config/
│       └── terms.json         # keyterm list
├── public/
│   ├── index.html             # static dashboard, no build step
│   └── app.js
└── samples/                    # sample call audio for the demo
```

Stages map 1:1 to `src/pipeline/*`. If a file doesn't correspond to a stage or a boundary, question whether it belongs.

---

## 9. Pipeline stages (reference)

| Stage | Module | Responsibility |
|---|---|---|
| 0 Source | `ingest.ts` | discover sample audio + metadata |
| 1 Ingest/Queue | `ingest.ts` | one job per call, processed sequentially |
| 2 Transcribe | `transcribe.ts` + `deepgram/client.ts` | Deepgram STT + redact + diarize + keyterm |
| 3 Normalize | `normalize.ts` | response → `CallRecord` (engine-independent boundary) |
| 4 Intelligence | `normalize.ts` | summary/topics → `CallRecord.intelligence` (merged in) |
| 5 Publish | `sinks/*` | `CallRecord` → CRM + analytics |
| 6 Validate | `validate.ts` | Deepgram vs. baseline → `CallRecord.validation` |
| 7 Dashboard | `server.ts` + `public/*` | run overview, drill-down, WER delta, cost projection |

---

## 10. Environment

`.env.example` (committed):

```
DEEPGRAM_API_KEY=
PORT=3000
DESTINATIONS=crm,analytics
CRM_WEBHOOK_URL=http://localhost:3000/mock-crm
INTELLIGENCE_ENABLED=false
# LLM_API_KEY=   # optional, only if structured summary uses an LLM
```

---

## 11. Definition of Done (MVP)

- `npm run dev` starts the server; opening the dashboard and triggering a run processes the `samples/` folder.
- Each call: transcribed via the SDK (nova-3, redact, diarize, keyterm), normalized to `CallRecord`, published to the mock CRM, visible in the dashboard with redacted PII.
- A broken sample does not stop the batch.
- No Deepgram-specific shape appears downstream of `normalize.ts`.
