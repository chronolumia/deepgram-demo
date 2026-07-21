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
const port = process.env.PORT ?? 3000;

app.use(express.json({ limit: "2mb" })); // Body-Parsing für /mock-crm & /api/run
app.use(express.static(path.join(__dirname, "..", "public")));


app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/mock-crm", (req, res) => {
  console.log(`[mock-crm] received callId=${req.body?.callId}`);
  res.json({ received: true, callId: req.body?.callId, receivedAt: new Date().toISOString() });
});


app.post("/api/run", async (_req, res) => {
  const records = await runBatch();
  lastRun = records;
  res.json({ count: records.length, records });
});

// returns the last run, without triggering the pipeline again. The dashboard calls this when loading, to avoid showing "no runs yet" after a reload, even though there is already a result.
app.get("/api/runs/latest", (_req, res) => {
  res.json({ count: lastRun?.length ?? 0, records: lastRun ?? [] });
});

app.listen(port, () => {
  console.log(`DataVoice Deepgram demo listening on http://localhost:${port}`);
});
