import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribeLocalFile, type TranscribeResponse } from "../deepgram/client.js";
import type { CallJob } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERMS_PATH = path.join(__dirname, "..", "config", "terms.json");

export async function loadKeyterms(): Promise<string[]> {
  const raw = await readFile(TERMS_PATH, "utf-8");
  return JSON.parse(raw);
}

// Transcribes a single call. transcribeLocalFile (not transcribeFile) because it turns a
// missing or unreadable audio file into a rejection that processJob can absorb into an
// error CallRecord, instead of an uncaughtException that would end the batch.
export async function transcribeCall(job: CallJob): Promise<TranscribeResponse> {
  const keyterms = await loadKeyterms();
  const includeIntelligence = process.env.INTELLIGENCE_ENABLED === "true";
  return transcribeLocalFile(job.audioPath, { keyterms, includeIntelligence });
}
