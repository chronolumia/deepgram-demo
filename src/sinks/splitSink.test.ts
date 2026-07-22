import { test } from "node:test";
import assert from "node:assert/strict";
import { SplitSink, routesToSink } from "./splitSink.js";
import { resolveSinks } from "./sink.js";
import type { Sink } from "./sink.js";
import type { CallRecord } from "../types/callRecord.js";

// The traffic split is the mechanism behind the "gradual migration with parallel systems"
// requirement, so the properties a migration actually depends on are asserted here — not
// just that it splits, but that it splits the SAME way twice and only ever grows.

function recordFor(callId: string): CallRecord {
  return {
    callId,
    source: { audioUri: `samples/${callId}.mp3`, startedAt: "2026-07-13T09:12:00Z", durationSec: 60 },
    transcript: { segments: [], redactedText: "" },
    intelligence: {},
    processing: { engine: "deepgram", model: "nova-3", processedAt: "2026-07-13T09:13:00Z" },
    schemaVersion: 1,
  };
}

class RecordingSink implements Sink {
  readonly name = "recording";
  readonly published: string[] = [];
  async publish(record: CallRecord): Promise<void> {
    this.published.push(record.callId);
  }
}

const ids = Array.from({ length: 500 }, (_, i) => `call-${String(i).padStart(4, "0")}`);

test("routesToSink: 100% routes everything, 0% routes nothing", () => {
  assert.ok(ids.every((id) => routesToSink(id, 100)));
  assert.ok(ids.every((id) => !routesToSink(id, 0)));
});

test("routesToSink: the same call always lands in the same cohort", () => {
  // Re-running a batch must not reshuffle routing, or a retry could publish a call that
  // already landed to a destination that already has it.
  for (const id of ids.slice(0, 50)) {
    assert.equal(routesToSink(id, 25), routesToSink(id, 25));
  }
});

test("routesToSink: raising the share is additive — nobody leaves a cohort", () => {
  // This is what makes a 5% -> 25% -> 50% ramp safe: each step only adds calls.
  for (const id of ids) {
    if (routesToSink(id, 25)) {
      assert.ok(routesToSink(id, 50), `${id} dropped out of the cohort when the share grew`);
    }
  }
});

test("routesToSink: the split is roughly the requested share", () => {
  const routed = ids.filter((id) => routesToSink(id, 25)).length;
  const share = routed / ids.length;
  // Wide tolerance on purpose: this asserts the hash spreads keys, not an exact quota.
  assert.ok(share > 0.15 && share < 0.35, `expected ~25%, got ${(share * 100).toFixed(1)}%`);
});

test("SplitSink: forwards only the cohort and leaves the wrapped sink untouched otherwise", async () => {
  const inner = new RecordingSink();
  const split = new SplitSink(inner, 50);

  for (const id of ids.slice(0, 100)) await split.publish(recordFor(id));

  assert.ok(inner.published.length > 0 && inner.published.length < 100);
  assert.ok(inner.published.every((id) => routesToSink(id, 50)));
});

test("SplitSink: names itself with the share so logs identify the cohort", () => {
  assert.equal(new SplitSink(new RecordingSink(), 25).name, "recording@25%");
});

test("resolveSinks: 'crm@25' produces a split sink, plain 'crm' does not", () => {
  assert.deepEqual(
    resolveSinks("crm@25,analytics").map((s) => s.name),
    ["crm@25%", "analytics"]
  );
});

test("resolveSinks: '@100' is treated as no split at all", () => {
  // Reaching 100% at the end of a ramp should leave exactly the unwrapped sink behind.
  assert.deepEqual(
    resolveSinks("crm@100").map((s) => s.name),
    ["crm"]
  );
});

test("resolveSinks: rejects a nonsensical share instead of guessing", () => {
  assert.throws(() => resolveSinks("crm@abc"), /Invalid traffic split/);
  assert.throws(() => resolveSinks("crm@150"), /Invalid traffic split/);
  assert.throws(() => resolveSinks("crm@-5"), /Invalid traffic split/);
});
