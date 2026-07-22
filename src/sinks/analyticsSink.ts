import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Sink } from "./sink.js";
import type { CallRecord } from "../types/callRecord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_PATH = path.join(__dirname, "..", "..", "data", "analytics.jsonl");

// Resolved per instance rather than at import time so a test can point the store at a temp
// file without writing into the repo's real data/ directory.
function outPath(): string {
  return process.env.ANALYTICS_PATH ?? DEFAULT_OUT_PATH;
}

// Stands in for the analytics warehouse: JSON Lines on disk, one CallRecord per line.
//
// Upsert by callId rather than blind append. Appending made re-running a batch accumulate
// duplicate rows, so every aggregate over the file (call volume, mean WER, total cost)
// silently over-counted — the failure mode of an analytics store that is wrong rather than
// missing. callId is the natural key, so a re-run corrects a record instead of doubling it,
// which also makes the whole pipeline safe to re-run after a partial failure.
//
// A real warehouse does this as an upsert on a primary key. Reading and rewriting the file
// per record is O(n^2) and only acceptable because n is a demo batch; it is the first thing
// to replace when persistence becomes real (see README, "Not built").
export class AnalyticsSink implements Sink {
  readonly name = "analytics";

  // Serializes writes. publish() is async and the file is read-modify-write, so two
  // overlapping calls would each read the same "before" state and the second would drop the
  // first one's record. Chaining keeps that impossible without reaching for a lock library.
  private writeQueue: Promise<void> = Promise.resolve();

  async publish(record: CallRecord): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.upsert(record));
    return this.writeQueue;
  }

  private async upsert(record: CallRecord): Promise<void> {
    const target = outPath();
    await mkdir(path.dirname(target), { recursive: true });

    const byCallId = new Map<string, CallRecord>();
    for (const existing of await this.readAll(target)) {
      byCallId.set(existing.callId, existing);
    }
    byCallId.set(record.callId, record);

    const body = [...byCallId.values()].map((r) => JSON.stringify(r)).join("\n") + "\n";

    // Write-then-rename: a crash mid-write leaves the previous complete file rather than a
    // truncated one with half a JSON object on the last line.
    const tmpPath = `${target}.tmp`;
    await writeFile(tmpPath, body, "utf-8");
    await rename(tmpPath, target);
  }

  private async readAll(target: string): Promise<CallRecord[]> {
    let raw: string;
    try {
      raw = await readFile(target, "utf-8");
    } catch {
      return []; // first run — no store yet
    }

    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as CallRecord];
        } catch {
          // Tolerate a corrupt line instead of failing the run: losing one historical row
          // is better than blocking every future publish on a file we can no longer parse.
          console.error("[analytics] skipping unparseable line in store");
          return [];
        }
      });
  }
}
