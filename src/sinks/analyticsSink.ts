import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Sink } from "./sink.js";
import type { CallRecord } from "../types/callRecord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "..", "data", "analytics.jsonl");

// simple Analytics store as a JSON objects file instead of real db
export class AnalyticsSink implements Sink {
  readonly name = "analytics";

  async publish(record: CallRecord): Promise<void> {
    await mkdir(path.dirname(OUT_PATH), { recursive: true });
    await appendFile(OUT_PATH, JSON.stringify(record) + "\n", "utf-8");
  }
}
