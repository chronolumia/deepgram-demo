import "dotenv/config";
import express from "express";
import { loadConfig } from "./config.js";
import { runBatch } from "./pipeline.js";
import type { CallRecord } from "./record.js";

const cfg = loadConfig();

if (!cfg.deepgramApiKey) {
  console.error("DEEPGRAM_API_KEY is not set");
  process.exit(1);
}

const app = express();
let lastRun: CallRecord[] | null = null;
let running = false;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(cfg.publicDir));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/mock-crm", (req, res) => {
  console.log(`[mock-crm] received callId=${req.body?.callId}`);
  res.json({ received: true, callId: req.body?.callId, receivedAt: new Date().toISOString() });
});

app.post("/api/run", async (_req, res) => {
  if (running) {
    res.status(409).json({ error: "a pipeline run is already in progress" });
    return;
  }

  running = true;
  try {
    const records = await runBatch();
    lastRun = records;
    res.json({ count: records.length, records });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/run]", message);
    res.status(500).json({ error: message });
  } finally {
    running = false;
  }
});

app.get("/api/runs/latest", (_req, res) => {
  res.json({ count: lastRun?.length ?? 0, records: lastRun ?? [] });
});

const server = app.listen(cfg.port, () => {
  console.log(`DataVoice Deepgram demo listening on http://localhost:${cfg.port}`);
});

function shutdown() {
  if (running) {
    console.log("waiting for in-flight pipeline run before shutdown");
  }
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
