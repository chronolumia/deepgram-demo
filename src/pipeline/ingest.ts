import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, "..", "..", "samples");

export interface CallJob {
  callId: string;
  // Absolute path, used only to open the file locally. Never published.
  audioPath: string;
  // The stable, machine-independent identifier that goes into CallRecord.source.audioUri.
  // Kept separate from audioPath because the record is POSTed to the CRM, and an absolute
  // path would leak the processing machine's directory layout into a downstream system
  // while being meaningless there. In production this becomes the object-store URI.
  audioUri: string;
  agentId?: string;
  startedAt: string;
}

interface SampleMetaEntry {
  file: string;
  callId: string;
  agentId?: string;
  startedAt: string;
}

// samples/meta.json pairs each audio file with call metadata that wouldn't otherwise exist on disk.
export async function discoverJobs(): Promise<CallJob[]> {
  const raw = await readFile(path.join(SAMPLES_DIR, "meta.json"), "utf-8");
  const entries: SampleMetaEntry[] = JSON.parse(raw);
  return entries.map((entry) => ({
    callId: entry.callId,
    audioPath: path.join(SAMPLES_DIR, entry.file),
    audioUri: `samples/${entry.file}`,
    agentId: entry.agentId,
    startedAt: entry.startedAt,
  }));
}
