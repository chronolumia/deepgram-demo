import { MODEL, type TranscribeResponse } from "./deepgram.js";

export type SpeakerRole = "agent" | "customer" | "unknown";

export interface TranscriptSegment {
  speaker: SpeakerRole;
  startSec: number;
  endSec: number;
  text: string;
}

export interface CallIntelligence {
  summary?: string;
  topics?: string[];
}

export interface ValidationResult {
  baselineLabel: string;
  wer: number;
  domainTermRecall: number;
}

export interface CallJob {
  callId: string;
  audioPath: string;
  agentId?: string;
  startedAt: string;
}

export interface CallRecord {
  callId: string;
  source: {
    audioUri: string;
    startedAt: string;
    durationSec: number;
    agentId?: string;
  };
  transcript: {
    segments: TranscriptSegment[];
    redactedText: string;
  };
  intelligence: CallIntelligence;
  validation?: ValidationResult;
  processing: {
    engine: "deepgram";
    model: string;
    processedAt: string;
  };
  error?: string;
  schemaVersion: 1;
}

type SuccessResponse = Extract<TranscribeResponse, { results: unknown }>;
type Channel = NonNullable<SuccessResponse["results"]["channels"]>[number];
type Alternative = NonNullable<Channel["alternatives"]>[number];
type Paragraph = NonNullable<NonNullable<Alternative["paragraphs"]>["paragraphs"]>[number];
type Utterance = NonNullable<SuccessResponse["results"]["utterances"]>[number];

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}

export function failedRecord(job: CallJob, err: unknown, processedAt = new Date().toISOString()): CallRecord {
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
    error: errorMessage(err),
    schemaVersion: 1,
  };
}

// Support calls typically open with the agent greeting, so the first diarized speaker is labeled agent.
function roleForSpeaker(speaker: number | undefined, speakingOrder: number[]): SpeakerRole {
  if (speaker === undefined) return "unknown";
  const position = speakingOrder.indexOf(speaker);
  if (position === 0) return "agent";
  if (position === 1) return "customer";
  return "unknown";
}

function speakingOrderOf(speakers: (number | undefined)[]): number[] {
  const order: number[] = [];
  for (const speaker of speakers) {
    if (speaker !== undefined && !order.includes(speaker)) order.push(speaker);
  }
  return order;
}

function segmentsFromParagraphs(paragraphs: Paragraph[]): TranscriptSegment[] {
  const speakingOrder = speakingOrderOf(paragraphs.map((paragraph) => paragraph.speaker));
  return paragraphs.map((paragraph) => ({
    speaker: roleForSpeaker(paragraph.speaker, speakingOrder),
    startSec: paragraph.start ?? 0,
    endSec: paragraph.end ?? 0,
    text: (paragraph.sentences ?? []).map((sentence) => sentence.text ?? "").join(" "),
  }));
}

function segmentsFromUtterances(utterances: Utterance[]): TranscriptSegment[] {
  const speakingOrder = speakingOrderOf(utterances.map((utterance) => utterance.speaker));
  return utterances.map((utterance) => ({
    speaker: roleForSpeaker(utterance.speaker, speakingOrder),
    startSec: utterance.start ?? 0,
    endSec: utterance.end ?? 0,
    text: utterance.transcript ?? "",
  }));
}

interface TopicsSegment {
  topics?: { topic?: string }[];
}

function extractIntelligence(response: SuccessResponse): CallIntelligence {
  const summary = response.results.summary?.short;
  const topicSegments =
    (response.results.topics as unknown as { segments?: TopicsSegment[] } | undefined)?.segments ?? [];

  const topics: string[] = [];
  for (const segment of topicSegments) {
    for (const t of segment.topics ?? []) {
      if (t.topic && !topics.includes(t.topic)) topics.push(t.topic);
    }
  }

  return {
    ...(summary ? { summary } : {}),
    ...(topics.length ? { topics } : {}),
  };
}

export function normalize(job: CallJob, response: TranscribeResponse): CallRecord {
  const processedAt = new Date().toISOString();

  if (!("results" in response)) {
    return failedRecord(job, "Deepgram returned no transcription results", processedAt);
  }

  const alternative = response.results.channels?.[0]?.alternatives?.[0];
  const paragraphs = alternative?.paragraphs?.paragraphs ?? [];
  let segments = segmentsFromParagraphs(paragraphs);
  if (segments.length === 0) {
    segments = segmentsFromUtterances(response.results.utterances ?? []);
  }

  return {
    callId: job.callId,
    source: {
      audioUri: job.audioPath,
      startedAt: job.startedAt,
      durationSec: response.metadata?.duration ?? 0,
      agentId: job.agentId,
    },
    transcript: {
      segments,
      redactedText: alternative?.transcript ?? "",
    },
    intelligence: extractIntelligence(response),
    processing: {
      engine: "deepgram",
      model: MODEL,
      processedAt,
    },
    schemaVersion: 1,
  };
}
