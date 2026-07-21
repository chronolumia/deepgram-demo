// The engine-independent data contract. Nothing Deepgram-specific may leak past
// normalize.ts (Stage 3) — downstream sinks and the dashboard only ever see this shape.

export type SpeakerRole = "agent" | "customer" | "unknown";

export interface TranscriptSegment {
  speaker: SpeakerRole;
  startSec: number;
  endSec: number;
  text: string; // already PII-redacted by Stage 2
}

export interface CallIntelligence {
  summary?: string;
  topics?: string[];
  // Extension point: intent, QA scorecard, sentiment.
}

export interface ValidationResult {
  baselineLabel: string; // what Deepgram was compared against
  // Disagreement rate vs. baselineLabel, not an accuracy score against
  // ground truth. Without a human-labeled reference this measures how much
  // the two differ, not which one is right.
  wer: number;
  domainTermRecall: number; // recall on the keyterm list (often > WER in value)
}

export interface CallRecord {
  callId: string;
  source: {
    audioUri: string;
    startedAt: string; // ISO-8601
    durationSec: number;
    agentId?: string;
  };
  transcript: {
    segments: TranscriptSegment[];
    redactedText: string; // full flat transcript, PII-redacted
  };
  intelligence: CallIntelligence;
  validation?: ValidationResult; // present only when shadow-run ran
  processing: {
    engine: "deepgram"; // explicit, so swappability is visible in the data
    model: string; // e.g. "nova-3"
    processedAt: string; // ISO-8601
    costUsd?: number;
  };
  error?: string; // set if this call failed; other fields best-effort
  schemaVersion: 1;
}
