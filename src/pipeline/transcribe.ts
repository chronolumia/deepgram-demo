import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribeFile, type TranscribeResponse } from "../deepgram/client.js";
import type { CallJob } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERMS_PATH = path.join(__dirname, "..", "config", "terms.json");


export async function loadKeyterms(): Promise<string[]> {
  const raw = await readFile(TERMS_PATH, "utf-8");
  return JSON.parse(raw);
}

// transcribe a single call
export async function transcribeCall(job: CallJob): Promise<TranscribeResponse> {
  const keyterms = await loadKeyterms();
  const includeIntelligence = process.env.INTELLIGENCE_ENABLED === "true";
  return transcribeFile(createReadStream(job.audioPath), { keyterms, includeIntelligence });
}
