import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./normalize.js";
import type { TranscribeResponse } from "../deepgram/client.js";
import type { CallJob } from "./ingest.js";

// normalize() is the Stage 3 boundary — the single place the engine-independence guarantee
// is either kept or broken. These tests are the guard on that invariant.

const job: CallJob = {
  callId: "call-004",
  audioPath: "/Users/someone/checkout/samples/call-004.mp3",
  audioUri: "samples/call-004.mp3",
  agentId: "agent-07",
  startedAt: "2026-07-13T09:12:00Z",
};

// Hand-built fixture rather than a recorded response: the SDK's generated types mark almost
// every field optional, so a literal needs the cast to stand in for a full response.
function responseWith(paragraphs: unknown[], transcript = "hello there"): TranscribeResponse {
  return {
    metadata: { duration: 63.5 },
    results: {
      channels: [{ alternatives: [{ transcript, paragraphs: { paragraphs } }] }],
    },
  } as unknown as TranscribeResponse;
}

function responseWithIntelligence(summary?: string, topicSegments?: unknown[]): TranscribeResponse {
  return {
    metadata: { duration: 60 },
    results: {
      channels: [{ alternatives: [{ transcript: "hi", paragraphs: { paragraphs: [] } }] }],
      ...(summary ? { summary: { short: summary } } : {}),
      ...(topicSegments ? { topics: { segments: topicSegments } } : {}),
    },
  } as unknown as TranscribeResponse;
}

test("normalize: publishes the portable audioUri, never the local absolute path", () => {
  // The record is POSTed to the CRM; an absolute path would leak the processing machine's
  // directory layout into a downstream system while being meaningless there.
  const record = normalize(job, responseWith([]));
  assert.equal(record.source.audioUri, "samples/call-004.mp3");
  assert.ok(!JSON.stringify(record).includes("/Users/"));
});

test("normalize: first speaker becomes agent, second becomes customer", () => {
  const record = normalize(
    job,
    responseWith([
      { speaker: 0, start: 0, end: 4, sentences: [{ text: "DataVoice support, how can I help?" }] },
      { speaker: 1, start: 4, end: 9, sentences: [{ text: "My SSO login is broken." }] },
      { speaker: 0, start: 9, end: 12, sentences: [{ text: "Let me check that." }] },
    ])
  );

  assert.deepEqual(
    record.transcript.segments.map((s) => s.speaker),
    ["agent", "customer", "agent"]
  );
});

test("normalize: a third speaker is 'unknown' rather than guessed", () => {
  const record = normalize(
    job,
    responseWith([
      { speaker: 0, start: 0, end: 2, sentences: [{ text: "one" }] },
      { speaker: 1, start: 2, end: 4, sentences: [{ text: "two" }] },
      { speaker: 2, start: 4, end: 6, sentences: [{ text: "three" }] },
    ])
  );

  assert.equal(record.transcript.segments[2]?.speaker, "unknown");
});

test("normalize: joins a paragraph's sentences and carries its timings", () => {
  const record = normalize(
    job,
    responseWith([
      { speaker: 0, start: 1.5, end: 6.25, sentences: [{ text: "First." }, { text: "Second." }] },
    ])
  );

  assert.deepEqual(record.transcript.segments[0], {
    speaker: "agent",
    startSec: 1.5,
    endSec: 6.25,
    text: "First. Second.",
  });
});

test("normalize: carries source metadata and marks the engine explicitly", () => {
  const record = normalize(job, responseWith([]));

  assert.equal(record.callId, "call-004");
  assert.equal(record.source.durationSec, 63.5);
  assert.equal(record.source.agentId, "agent-07");
  assert.equal(record.processing.engine, "deepgram");
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.error, undefined);
});

test("normalize: no Deepgram-shaped key survives the boundary", () => {
  // The point of Stage 3: swapping the engine must not require touching anything downstream.
  const record = normalize(
    job,
    responseWith([{ speaker: 0, start: 0, end: 2, sentences: [{ text: "hi" }] }])
  );
  const keys = JSON.stringify(record);

  for (const leaked of ["channels", "alternatives", "paragraphs", "metadata", "confidence", "words"]) {
    assert.ok(!keys.includes(`"${leaked}"`), `CallRecord leaked Deepgram's "${leaked}" key`);
  }
});

test("normalize: records an estimated cost so the analytics store can answer cost-per-call", () => {
  const record = normalize(job, responseWith([]));

  // 63.5s at $0.0130/min (nova-3 + diarize + redact + keyterm).
  assert.ok(record.processing.costUsd !== undefined);
  assert.equal(record.processing.costUsd?.toFixed(5), ((63.5 / 60) * 0.013).toFixed(5));
});

test("normalize: intelligence is absent, not empty-valued, when Deepgram returned none", () => {
  // Omitting the keys keeps "we didn't ask for it" distinguishable from "it came back blank".
  const record = normalize(job, responseWithIntelligence());

  assert.deepEqual(record.intelligence, {});
});

test("normalize: extracts the summary and de-duplicates topics across segments", () => {
  const record = normalize(
    job,
    responseWithIntelligence("Customer could not log in via SSO.", [
      { topics: [{ topic: "authentication" }, { topic: "login" }] },
      { topics: [{ topic: "login" }, { topic: "billing" }] },
    ])
  );

  assert.equal(record.intelligence.summary, "Customer could not log in via SSO.");
  assert.deepEqual(record.intelligence.topics, ["authentication", "login", "billing"]);
});

test("normalize: an async callback response degrades to an error record, not a throw", () => {
  // A record with error set still has to be a valid CallRecord so the batch keeps going.
  const record = normalize(job, { request_id: "abc-123" } as unknown as TranscribeResponse);

  assert.match(record.error ?? "", /async callback/);
  assert.equal(record.schemaVersion, 1);
  assert.deepEqual(record.transcript.segments, []);
  assert.equal(record.source.audioUri, "samples/call-004.mp3");
});
