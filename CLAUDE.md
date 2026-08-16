# CLAUDE.md — Repo Contract

Reference integration: **Deepgram** as the speech-to-text + audio-intelligence engine inside **DataVoice Inc.**'s customer-support call pipeline. DataVoice is migrating from a competitor, processes ~10,000 hours of recorded calls/month, and needs the output integrated into their existing CRM + analytics.

This file is the binding contract for how the repo is built. Follow it over habit or convention.

---

## 1. What we are building (and what we are not)

**We build:** a batch pipeline that takes recorded support calls, transcribes + enriches them with Deepgram, normalizes them into an engine-independent record, and publishes them to (mock) CRM + analytics sinks — plus an optional shadow-run validation view and a static dashboard.

**The through-line that MUST work end to end:** ingest → transcribe → normalize → publish (a call is transcribed, normalized, lands in the mock CRM). Everything else makes it convincing or presentable, not functional.

### Non-goals (do NOT build these)
- **No Next.js. No frontend bundler/build step.** Plain Node backend + a static dashboard page.
- **No real database.** In-memory + JSON files on disk. Production persistence is *described* in the plan, not built.
- **No auth / RBAC / user management.**
- **No Voice Agent API, no telephony, no TTS.** Real-time agent-assist is an optional, clearly separated second act — not the core.
- **No custom Deepgram model training.** Terminology is handled via keyterm prompting; custom models are a documented Part-2 escalation only.
- **No real CRM.** A mock webhook endpoint stands in for it.
- Do not add edge-case handling that isn't on the through-line. "Water through pipes over coverage for every edge case."
- **No worker pool, traffic-split, or queue library** until ingest is no longer a local `samples/` folder.

---

## 2. Tech stack (fixed)

- **Runtime:** Node 20, **TypeScript** (strict).
- **Backend:** Express. Serves the static dashboard and a small API that triggers pipeline runs.
- **Deepgram:** the official **`@deepgram/sdk`** — used for STT (prerecorded) and audio intelligence via Listen options (`summarize` / `topics`). **Never hand-roll REST/WebSocket calls against Deepgram.**
- **Frontend:** one static HTML page + vanilla JS. No build step.
- **Tests:** Node's built-in test runner (`node:test`) via `tsx --test`. No extra test framework.

---

## 3. Code conventions

- **Comment design decisions, not obvious code.** A comment explains *why* a non-obvious choice was made (a Deepgram option, the normalization boundary, a trade-off) — never restates what the line already says.
- **One place per concern.** All Deepgram options live in `src/deepgram.ts`. Destinations are selected in `src/pipeline.ts`. The `CallRecord` type in `src/record.ts` is the single source of truth for the data contract.
- **TypeScript strict**, no `any` on public boundaries. Prefer small functions over classes and interfaces-with-one-implementation.
- **No secrets in code.** Everything via env (`.env`, with `.env.example` committed).
- **Paths** resolve from `process.cwd()` so `tsx` and compiled `node dist/server.js` (run from the repo root) both work.

---

## 4. Inviolable product concepts

These two ideas are the reason the architecture exists. Do not erode them.

1. **Engine independence via the `CallRecord` contract.** Downstream systems (CRM, analytics) never see Deepgram's response shape — only our normalized `CallRecord`. This is what makes the vendor swappable without touching downstream. `normalize()` in `src/record.ts` is the boundary; nothing Deepgram-specific may leak past it.

2. **Destinations selected by config.** `DESTINATIONS=crm,analytics` chooses publishers. Adding or removing a destination must never require changes inside transcribe/normalize.

---

## 5. The data contract — `CallRecord`

`src/record.ts` is the single source of truth. Keep it engine-independent.

```typescript
export type SpeakerRole = "agent" | "customer" | "unknown";

export interface TranscriptSegment {
  speaker: SpeakerRole;
  startSec: number;
  endSec: number;
  text: string; // already PII-redacted by Deepgram
}

export interface CallIntelligence {
  summary?: string;
  topics?: string[];
}

export interface ValidationResult {
  baselineLabel: string;
  wer: number; // disagreement vs baseline, not verified accuracy
  domainTermRecall: number;
}

export interface CallRecord {
  callId: string;
  source: {
    audioUri: string;
    startedAt: string; // ISO-8601
    durationSec: number;
    agentId?: string;
  };
  transcript: {
    segments: TranscriptSegment[];
    redactedText: string;
  };
  intelligence: CallIntelligence;
  validation?: ValidationResult; // present only when SHADOW_VALIDATION ran
  processing: {
    engine: "deepgram";
    model: string;
    processedAt: string;
  };
  error?: string;
  schemaVersion: 1;
}
```

---

## 6. Destinations

Publishers live in `src/pipeline.ts` and are activated by `DESTINATIONS`.

- `crm` → POST the `CallRecord` to `CRM_WEBHOOK_URL` (timeout via `AbortSignal`).
- `analytics` → append one JSON line to `data/analytics.jsonl`.

Unknown names fail the batch (config error), not an individual call.

---

## 7. Deepgram usage rules

- All Deepgram access goes through **`src/deepgram.ts`**. It is the only file that imports `@deepgram/sdk` and the only place transcription options are set.
- **Batch/prerecorded** options: `model=nova-3`, `diarize`, `smart_format`, `paragraphs`, `redact`, `keyterm`, `language=en`.
- **Audio intelligence** (optional): Listen flags `summarize=v2` / `topics` when `INTELLIGENCE_ENABLED=true`. Do not add a separate Read-API wrapper for this.
- Exact SDK method names/namespaces are authoritative in the installed `@deepgram/sdk` (`listen.v1.media.transcribeFile`).
- Keyterm list: `src/terms.json`.
- Calls use a timeout (`DEEPGRAM_TIMEOUT_MS`, default 120s) and `maxRetries: 0`.

---

## 8. Folder structure

```
/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── server.ts      # Express: dashboard + API + mock CRM
│   ├── pipeline.ts    # ingest → transcribe → publish
│   ├── deepgram.ts    # only file that touches @deepgram/sdk
│   ├── record.ts      # CallRecord + normalize() + failedRecord()
│   ├── config.ts      # env + terms.json load
│   ├── validate.ts    # pure WER / domain-term recall (optional)
│   └── terms.json
├── public/
│   ├── index.html
│   └── app.js
└── samples/
```

If a file doesn't correspond to HTTP, the pipeline, Deepgram, the data contract, or config, question whether it belongs.

---

## 9. Pipeline flow

| Step | Module | Responsibility |
|---|---|---|
| Source | `pipeline.ts` `discoverJobs` | read `samples/meta.json` |
| Transcribe | `deepgram.ts` | Deepgram STT + redact + diarize + keyterm |
| Normalize | `record.ts` | response → `CallRecord` |
| Intelligence | `record.ts` | summary/topics merged when the Listen flags were set |
| Publish | `pipeline.ts` | `CallRecord` → CRM + analytics |
| Validate | `validate.ts` via `pipeline.ts` | only when `SHADOW_VALIDATION=true` |
| Dashboard | `server.ts` + `public/*` | run overview + drill-down |

Default path is transcribe → normalize → publish. A broken sample does not stop the batch.

---

## 10. Environment

`.env.example` (committed):

```
DEEPGRAM_API_KEY=
PORT=3000
DESTINATIONS=crm,analytics
CRM_WEBHOOK_URL=http://localhost:3000/mock-crm
INTELLIGENCE_ENABLED=false
SHADOW_VALIDATION=false
```

The process refuses to boot without `DEEPGRAM_API_KEY`. `POST /api/run` returns 409 if a run is already in progress.

---

## 11. Definition of Done (MVP)

- `npm run dev` starts the server; opening the dashboard and triggering a run processes the `samples/` folder.
- Each call: transcribed via the SDK (nova-3, redact, diarize, paragraphs, keyterm), normalized to `CallRecord`, published to the mock CRM, visible in the dashboard with redacted PII.
- A broken sample does not stop the batch.
- No Deepgram-specific shape appears downstream of `normalize()`.
