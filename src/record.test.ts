import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscribeResponse } from "./deepgram.js";
import { failedRecord, normalize, type CallJob } from "./record.js";

const job: CallJob = {
  callId: "call-001",
  audioPath: "/tmp/call-001.wav",
  agentId: "agent-07",
  startedAt: "2026-06-29T14:32:00Z",
};

function successResponse(): TranscribeResponse {
  return {
    metadata: { duration: 12.5 },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "Hello this is DataVoice support. Hi I need help.",
              paragraphs: {
                paragraphs: [
                  {
                    speaker: 0,
                    start: 0,
                    end: 4,
                    sentences: [{ text: "Hello this is DataVoice support." }],
                  },
                  {
                    speaker: 1,
                    start: 4.1,
                    end: 8,
                    sentences: [{ text: "Hi I need help." }],
                  },
                ],
              },
            },
          ],
        },
      ],
      summary: { short: "A customer asks for help." },
      topics: { segments: [{ topics: [{ topic: "support" }, { topic: "support" }] }] },
    },
  } as TranscribeResponse;
}

test("normalize maps paragraphs, roles, duration, and intelligence", () => {
  const record = normalize(job, successResponse());

  assert.equal(record.callId, "call-001");
  assert.equal(record.error, undefined);
  assert.equal(record.source.durationSec, 12.5);
  assert.equal(record.source.agentId, "agent-07");
  assert.equal(record.transcript.redactedText, "Hello this is DataVoice support. Hi I need help.");
  assert.equal(record.transcript.segments.length, 2);
  assert.equal(record.transcript.segments[0]?.speaker, "agent");
  assert.equal(record.transcript.segments[0]?.text, "Hello this is DataVoice support.");
  assert.equal(record.transcript.segments[1]?.speaker, "customer");
  assert.equal(record.intelligence.summary, "A customer asks for help.");
  assert.deepEqual(record.intelligence.topics, ["support"]);
  assert.equal(record.processing.engine, "deepgram");
  assert.equal(record.schemaVersion, 1);
});

test("normalize falls back to utterances when paragraphs are missing", () => {
  const response = {
    metadata: { duration: 3 },
    results: {
      channels: [{ alternatives: [{ transcript: "Hello there" }] }],
      utterances: [
        { speaker: 0, start: 0, end: 1.2, transcript: "Hello" },
        { speaker: 1, start: 1.2, end: 3, transcript: "there" },
      ],
    },
  } as TranscribeResponse;

  const record = normalize(job, response);
  assert.equal(record.transcript.segments.length, 2);
  assert.equal(record.transcript.segments[0]?.speaker, "agent");
  assert.equal(record.transcript.segments[1]?.speaker, "customer");
  assert.equal(record.transcript.segments[1]?.text, "there");
});

test("normalize records an error when Deepgram returns no results", () => {
  const record = normalize(job, { request_id: "abc" } as TranscribeResponse);
  assert.equal(record.error, "Deepgram returned no transcription results");
  assert.equal(record.transcript.redactedText, "");
  assert.equal(record.transcript.segments.length, 0);
});

test("failedRecord keeps source identity and sets error", () => {
  const record = failedRecord(job, new Error("timed out"));
  assert.equal(record.callId, "call-001");
  assert.equal(record.source.audioUri, job.audioPath);
  assert.equal(record.error, "timed out");
  assert.equal(record.source.durationSec, 0);
});
