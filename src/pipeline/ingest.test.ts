import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { discoverJobs } from "./ingest.js";

// Guards the manifest itself, not just the code that reads it. The demo once ran happily
// against audio nobody intended to process, so "every entry in meta.json resolves to a file
// that exists" is worth asserting automatically rather than noticing during a run.

test("discoverJobs: every manifest entry points at a file that exists", async () => {
  const jobs = await discoverJobs();

  assert.ok(jobs.length > 0, "samples/meta.json lists no calls");
  for (const job of jobs) {
    assert.ok(existsSync(job.audioPath), `${job.callId} points at missing audio: ${job.audioPath}`);
  }
});

test("discoverJobs: callIds are unique", async () => {
  // Duplicated ids would collide in the analytics store's upsert-by-callId.
  const ids = (await discoverJobs()).map((j) => j.callId);
  assert.equal(new Set(ids).size, ids.length);
});

test("discoverJobs: audioUri is repo-relative while audioPath stays absolute", async () => {
  const jobs = await discoverJobs();

  for (const job of jobs) {
    assert.ok(job.audioPath.startsWith("/"), "audioPath must be absolute to open the file");
    assert.ok(job.audioUri.startsWith("samples/"), "audioUri must be portable — it is published");
    assert.ok(!job.audioUri.includes("/Users/"), "audioUri leaked a local absolute path");
  }
});

test("discoverJobs: carries the metadata the CallRecord needs", async () => {
  for (const job of await discoverJobs()) {
    assert.match(job.startedAt, /^\d{4}-\d{2}-\d{2}T/, `${job.callId} has no ISO-8601 startedAt`);
  }
});
