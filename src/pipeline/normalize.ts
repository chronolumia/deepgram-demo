import { MODEL, type TranscribeResponse } from "../deepgram/client.js";
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

// speaker index to CallRecord role (agent/customer/unknown)
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

  const topicSegments = (results.topics as unknown as { segments?: TopicsSegment[] } | undefined)?.segments ?? [];

  // TODO: make more performant for prod
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
        audioUri: job.audioPath,
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
      audioUri: job.audioPath,
      startedAt: job.startedAt,
      durationSec: response.metadata.duration,
      agentId: job.agentId,
    },
    transcript: {
      segments: toSegments(paragraphs),
      redactedText: alternative?.transcript ?? "",
    },
    // Stage 4: empty, since INTELLIGENCE_ENABLED is not set
    intelligence: extractIntelligence(response),
    processing: {
      engine: "deepgram",
      model: MODEL,
      processedAt,
    },
    schemaVersion: 1,
  };
}
