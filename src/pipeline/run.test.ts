import { test } from "node:test";
import assert from "node:assert/strict";
import { publishToSinks } from "./run.js";
import type { Sink } from "../sinks/sink.js";
import type { CallRecord } from "../types/callRecord.js";

// Publishing must be isolated the same way transcription is: one broken destination costs
// that destination only. Otherwise a flaky analytics disk takes the CRM down with it, and
// the "add a destination without touching the pipeline" promise comes with a hidden clause.

const record: CallRecord = {
  callId: "call-004",
  source: { audioUri: "samples/call-004.mp3", startedAt: "2026-07-13T09:12:00Z", durationSec: 58 },
  transcript: { segments: [], redactedText: "" },
  intelligence: {},
  processing: { engine: "deepgram", model: "nova-3", processedAt: "2026-07-13T09:13:00Z" },
  schemaVersion: 1,
};

class OkSink implements Sink {
  published = 0;
  constructor(readonly name: string) {}
  async publish(): Promise<void> {
    this.published++;
  }
}

class FailingSink implements Sink {
  readonly name = "failing";
  async publish(): Promise<void> {
    throw new Error("destination unavailable");
  }
}

test("publishToSinks: a failing destination does not stop the others", async () => {
  const before = new OkSink("before");
  const after = new OkSink("after");

  await publishToSinks(record, [before, new FailingSink(), after]);

  assert.equal(before.published, 1);
  assert.equal(after.published, 1);
});

test("publishToSinks: a failing destination does not reject, so the batch continues", async () => {
  // processJob already produced a valid CallRecord; a publish failure must not undo that.
  await assert.doesNotReject(() => publishToSinks(record, [new FailingSink()]));
});

test("publishToSinks: every configured destination receives the same record", async () => {
  const crm = new OkSink("crm");
  const analytics = new OkSink("analytics");

  await publishToSinks(record, [crm, analytics]);

  assert.equal(crm.published, 1);
  assert.equal(analytics.published, 1);
});
