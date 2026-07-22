import { MODEL, estimateCostUsd, type TranscribeResponse } from "../deepgram/client.js";
import type { CallJob } from "./ingest.js";
import type { CallIntelligence, CallRecord, SpeakerRole, TranscriptSegment } from "../types/callRecord.js";

// Stage 3 boundary: everything below this line is Deepgram's response shape;
// everything that returns from normalize() is engine-independent CallRecord.
// The generated SDK types mark almost every field optional (fern codegen from
// an API where most fields are conditional on request options), so this is
// built with NonNullable unwraps rather than a flat interface.
type SuccessResponse = Extract<TranscribeResponse, { results: unknown }>;
type Channel = NonNullable<SuccessResponse["results"]["channels"]>[number];
type Alternative = NonNullable<Channel["alternatives"]>[number];
type Paragraph = NonNullable<NonNullable<Alternative["paragraphs"]>["paragraphs"]>[number];

// Maps Deepgram's speaker index to a CallRecord role using a deliberate heuristic:
// whoever speaks first is the agent. That holds for calls the agent opens with a greeting
// and breaks whenever the customer speaks first — and when it breaks, every segment in the
// call is labelled backwards, and that inverted label is what reaches the CRM.
//
// It stays a heuristic because diarization returns anonymous speaker indices, not identities.
// The real fix is channel-level separation (agent and customer on separate audio channels,
// which most call recorders can emit) — then the role comes from the channel, not from who
// talked first. Documented rather than silently assumed, because a wrong speaker label is
// harder to notice downstream than a missing one.
//
// Speakers beyond the first two are "unknown" — a supervisor joining a call is real, but
// guessing which of three voices is "the customer" would be inventing data.
function roleForSpeaker(speaker: number | undefined, speakingOrder: number[]): SpeakerRole {
  if (speaker === undefined) return "unknown";
  const position = speakingOrder.indexOf(speaker);
  if (position === 0) return "agent";
  if (position === 1) return "customer";
  return "unknown";
}

// builds the list of TranscriptSegments from the paragraphs
function toSegments(paragraphs: Paragraph[]): TranscriptSegment[] {
  const speakingOrder: number[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.speaker !== undefined && !speakingOrder.includes(paragraph.speaker)) {
      speakingOrder.push(paragraph.speaker);
    }
  }
  return paragraphs.map((paragraph) => ({
    speaker: roleForSpeaker(paragraph.speaker, speakingOrder),
    startSec: paragraph.start ?? 0,
    endSec: paragraph.end ?? 0,
    text: (paragraph.sentences ?? []).map((sentence) => sentence.text ?? "").join(" "),
  }));
}

interface TopicsSegment {
  topics?: { topic?: string }[];
}

// extracts summary and topics from the response
function extractIntelligence(response: TranscribeResponse): CallIntelligence {
  if (!("results" in response)) return {};

  const results = response.results;

  const summary = results.summary?.short;

  const topicSegments =
    (results.topics as unknown as { segments?: TopicsSegment[] } | undefined)?.segments ?? [];

  // Linear scan to de-duplicate rather than a Set, to preserve the order Deepgram returned
  // topics in — the dashboard shows them as a row, and stable order reads better than
  // insertion-hash order. A call has a handful of topics; this is not a hot path.
  const topics: string[] = [];
  for (const segment of topicSegments) {
    for (const t of segment.topics ?? []) {
      if (t.topic && !topics.includes(t.topic)) {
        topics.push(t.topic);
      }
    }
  }

  return {
    ...(summary ? { summary } : {}),
    ...(topics.length ? { topics } : {}),
  };
}

// Stage 3 boundary: Deepgram response -> engine-independent CallRecord.
export function normalize(job: CallJob, response: TranscribeResponse): CallRecord {
  const processedAt = new Date().toISOString();

  if (!("results" in response)) {
    return {
      callId: job.callId,
      source: {
        audioUri: job.audioUri,
        startedAt: job.startedAt,
        durationSec: 0,
        agentId: job.agentId,
      },
      transcript: { segments: [], redactedText: "" },
      intelligence: {},
      processing: { engine: "deepgram", model: MODEL, processedAt },
      error: "Deepgram returned an async callback response; a synchronous result was expected.",
      schemaVersion: 1,
    };
  }

  const alternative = response.results.channels[0]?.alternatives?.[0];
  const paragraphs = alternative?.paragraphs?.paragraphs ?? [];

  return {
    callId: job.callId,
    source: {
      audioUri: job.audioUri,
      startedAt: job.startedAt,
      durationSec: response.metadata.duration,
      agentId: job.agentId,
    },
    transcript: {
      segments: toSegments(paragraphs),
      redactedText: alternative?.transcript ?? "",
    },
    // Stage 4 merges in here rather than in its own module: summary/topics ride along on
    // the same prerecorded response, so splitting them out would mean re-parsing it.
    // Empty unless INTELLIGENCE_ENABLED requested them (see transcribe.ts).
    intelligence: extractIntelligence(response),
    processing: {
      engine: "deepgram",
      model: MODEL,
      processedAt,
      // Recorded per call rather than derived in the dashboard, so the analytics store can
      // answer "cost per call over time" — the question that actually matters during a
      // migration — instead of only the current batch being able to.
      costUsd: estimateCostUsd(response.metadata.duration),
    },
    schemaVersion: 1,
  };
}
