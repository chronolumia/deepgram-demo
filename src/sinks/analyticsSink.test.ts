import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AnalyticsSink } from "./analyticsSink.js";
import type { CallRecord } from "../types/callRecord.js";

// The behaviour under test is upsert-by-callId. Blind appending made every aggregate over
// the store (call volume, mean WER, total cost) over-count after any re-run — an analytics
// store that is wrong is worse than one that is missing, because nothing looks broken.

let dir: string;
let store: string;

function recordFor(callId: string, costUsd: number): CallRecord {
  return {
    callId,
    source: { audioUri: `samples/${callId}.mp3`, startedAt: "2026-07-13T09:12:00Z", durationSec: 60 },
    transcript: { segments: [], redactedText: "" },
    intelligence: {},
    processing: { engine: "deepgram", model: "nova-3", processedAt: "2026-07-13T09:13:00Z", costUsd },
    schemaVersion: 1,
  };
}

async function readStore(): Promise<CallRecord[]> {
  const raw = await readFile(store, "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as CallRecord);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "analytics-test-"));
  store = path.join(dir, "analytics.jsonl");
  process.env.ANALYTICS_PATH = store;
});

afterEach(async () => {
  delete process.env.ANALYTICS_PATH;
  await rm(dir, { recursive: true, force: true });
});

test("AnalyticsSink: writes one line per call", async () => {
  const sink = new AnalyticsSink();
  await sink.publish(recordFor("call-004", 0.01));
  await sink.publish(recordFor("call-005", 0.02));

  assert.deepEqual(
    (await readStore()).map((r) => r.callId),
    ["call-004", "call-005"]
  );
});

test("AnalyticsSink: re-publishing a call updates it instead of duplicating it", async () => {
  const sink = new AnalyticsSink();
  await sink.publish(recordFor("call-004", 0.01));
  await sink.publish(recordFor("call-004", 0.99));

  const stored = await readStore();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.processing.costUsd, 0.99); // last write wins
});

test("AnalyticsSink: a whole re-run leaves the store the same size", async () => {
  // The regression that motivated this: 3 calls across ~10 runs left 29 rows behind.
  const sink = new AnalyticsSink();
  const batch = ["call-004", "call-005", "call-006"];

  for (const id of batch) await sink.publish(recordFor(id, 0.01));
  for (const id of batch) await sink.publish(recordFor(id, 0.01));

  assert.equal((await readStore()).length, 3);
});

test("AnalyticsSink: concurrent publishes do not lose records", async () => {
  // publish() is read-modify-write, so overlapping calls would otherwise each read the same
  // "before" state and the last writer would silently drop the others.
  const sink = new AnalyticsSink();
  await Promise.all(
    ["call-004", "call-005", "call-006", "call-007"].map((id) => sink.publish(recordFor(id, 0.01)))
  );

  assert.equal((await readStore()).length, 4);
});

test("AnalyticsSink: a corrupt line is skipped rather than blocking every future write", async () => {
  await writeFile(store, '{"callId":"call-001"}\nthis is not json\n', "utf-8");

  await new AnalyticsSink().publish(recordFor("call-004", 0.01));

  assert.deepEqual(
    (await readStore()).map((r) => r.callId),
    ["call-001", "call-004"]
  );
});
