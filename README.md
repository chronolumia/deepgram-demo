# DataVoice × Deepgram batch pipeline

Recorded support calls go through Deepgram prerecorded STT, are normalized into an engine-independent `CallRecord`, and are published to a mock CRM plus a JSONL analytics file.

```
samples/meta.json  →  Deepgram listen  →  CallRecord  →  CRM webhook + analytics.jsonl
```

## Run

```bash
cp .env.example .env   # set DEEPGRAM_API_KEY
npm install
npm run dev
```

Open http://localhost:3000 and click **Run pipeline**, or:

```bash
curl -s -X POST http://localhost:3000/api/run
```

Compiled start (after `npm run build`) also works — paths are resolved from the process working directory, so run `npm start` from the repo root.

## Layout

| File | Responsibility |
|---|---|
| [`src/server.ts`](src/server.ts) | HTTP: dashboard, mock CRM, `POST /api/run` |
| [`src/pipeline.ts`](src/pipeline.ts) | Discover jobs → transcribe → publish |
| [`src/deepgram.ts`](src/deepgram.ts) | Only file that imports `@deepgram/sdk` |
| [`src/record.ts`](src/record.ts) | `CallRecord` contract + `normalize()` |
| [`src/config.ts`](src/config.ts) | Env + keyterm list |
| [`src/validate.ts`](src/validate.ts) | Optional WER / domain-term recall (off by default) |
| [`public/`](public/) | Static dashboard (no build step) |
| [`samples/`](samples/) | Demo call audio + `meta.json` |

## Config

See [`.env.example`](.env.example). Shadow validation (a second Deepgram pass against model `base`) is **off** unless `SHADOW_VALIDATION=true`. Audio intelligence (summary/topics) is off unless `INTELLIGENCE_ENABLED=true`.

## Scripts

- `npm run dev` — watch server
- `npm run build && npm start` — compiled
- `npm test`
- `npm run typecheck`
