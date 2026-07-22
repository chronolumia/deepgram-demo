import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBatch } from "./pipeline/run.js";
import type { CallRecord } from "./types/callRecord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// holds the result of the last batch run in the server process
let lastRun: CallRecord[] | null = null;
// Guards against a second batch starting while one is in flight. The dashboard disables its
// own button, but a second tab, a reload or a curl bypasses that — and two concurrent runs
// interleave appends into analytics.jsonl and race on lastRun.
let isRunning = false;
const port = process.env.PORT ?? 3000;

app.use(express.json({ limit: "2mb" })); // body parsing for /mock-crm & /api/run
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/mock-crm", (req, res) => {
  console.log(`[mock-crm] received callId=${req.body?.callId}`);
  res.json({ received: true, callId: req.body?.callId, receivedAt: new Date().toISOString() });
});

app.post("/api/run", async (_req, res) => {
  if (isRunning) {
    res.status(409).json({ error: "A batch run is already in progress." });
    return;
  }

  isRunning = true;
  try {
    const records = await runBatch();
    lastRun = records;
    res.json({ count: records.length, records });
  } catch (err) {
    // A throw here means the batch itself could not start (bad DESTINATIONS, unreadable
    // meta.json) — per-call failures are already absorbed into their own CallRecord.
    // Surfacing the reason beats letting the dashboard render a bare "HTTP 500".
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/run] batch failed:", message);
    res.status(500).json({ error: message });
  } finally {
    isRunning = false;
  }
});

// returns the last run, without triggering the pipeline again. The dashboard calls this when loading, to avoid showing "no runs yet" after a reload, even though there is already a result.
app.get("/api/runs/latest", (_req, res) => {
  res.json({ count: lastRun?.length ?? 0, records: lastRun ?? [] });
});

app.listen(port, () => {
  console.log(`DataVoice Deepgram demo listening on http://localhost:${port}`);
});
