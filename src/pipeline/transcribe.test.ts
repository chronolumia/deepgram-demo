import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribeCall } from "./transcribe.js";
import type { CallJob } from "./ingest.js";

// Regression test for a crash, not a style preference.
//
// transcribeCall used to hand createReadStream's output straight to the SDK. A missing file
// makes that stream emit an async 'error' EVENT, which is unrelated to any try/catch up the
// call stack — so it became an uncaughtException, killed the server process mid-batch, and
// took every remaining call with it. That is the precise failure CLAUDE.md section 11 rules
// out ("a broken sample does not stop the batch").
//
// This test never reaches the network: the stat() guard rejects first, so it costs nothing
// to run and stays honest without an API key.

test("transcribeCall: a missing audio file rejects instead of crashing the process", async () => {
  const job: CallJob = {
    callId: "call-999",
    audioPath: "/nonexistent/path/does-not-exist.mp3",
    audioUri: "samples/does-not-exist.mp3",
    startedAt: "2026-07-20T10:00:00Z",
  };

  // A rejection is what run.ts's processJob can absorb into an error CallRecord.
  await assert.rejects(() => transcribeCall(job), /ENOENT/);
});
