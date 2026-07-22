import { DeepgramClient } from "@deepgram/sdk";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";

// Note: every transcription option lives here so a vendor swap touches one file.
const client = new DeepgramClient(); // reads DEEPGRAM_API_KEY from env

// v5.5.0 doesn't export MediaTranscribeResponse from the package root, so we derive it from the method itself
export type TranscribeResponse = Awaited<ReturnType<typeof client.listen.v1.media.transcribeUrl>>;

export interface TranscribeOptions {
  keyterms?: string[];
  model?: string;
  includeIntelligence?: boolean;
}

export const MODEL = "nova-3" as const;

// Stands in for the incumbent vendor in the shadow run. A weaker Deepgram tier is not the
// incumbent's actual behaviour — it only demonstrates the mechanism. See VALIDATION.md §2.
export const BASELINE_MODEL = "base" as const;

function buildParams(options: TranscribeOptions) {
  return {
    model: options.model ?? MODEL,
    diarize: true,
    smart_format: true,
    redact: "pii",
    language: "en",
    ...(options.keyterms?.length ? { keyterm: options.keyterms } : {}),
    ...(options.includeIntelligence ? { summarize: "v2", topics: true } : {}),
  };
}

// Pay-as-you-go list rates from deepgram.com/pricing. They live beside buildParams on
// purpose: the price of a call is a function of the options set right above, so the two
// drift apart the moment they live in different files. This is the only rate table in the
// repo — the dashboard reads CallRecord.processing.costUsd rather than recomputing.
const RATE_USD_PER_MIN = {
  nova3Monolingual: 0.0077,
  diarize: 0.002,
  redact: 0.002,
  keyterm: 0.0013,
  // smart_format is included at no extra charge.
} as const;

export const COST_PER_MINUTE_USD =
  RATE_USD_PER_MIN.nova3Monolingual +
  RATE_USD_PER_MIN.diarize +
  RATE_USD_PER_MIN.redact +
  RATE_USD_PER_MIN.keyterm;

// Estimated spend on the primary transcription pass for one call.
//
// Two deliberate exclusions, both because a made-up number is worse than a stated gap:
//   - The shadow-run baseline pass. It re-transcribes the call against a legacy tier whose
//     per-minute rate Deepgram no longer publishes, so it cannot be priced honestly here.
//     It is also a migration-period cost, not a steady-state one. The dashboard says so.
//   - Audio intelligence (summarize/topics), which Deepgram bills per token, not per minute.
export function estimateCostUsd(durationSec: number): number {
  return (durationSec / 60) * COST_PER_MINUTE_USD;
}

// Used only by scripts/hello.ts as an SDK smoke test; the pipeline itself streams local
// files via transcribeFile. Kept because it is the fastest way to check key + connectivity.
export async function transcribeUrl(
  url: string,
  options: TranscribeOptions = {}
): Promise<TranscribeResponse> {
  return client.listen.v1.media.transcribeUrl({
    url,
    ...buildParams(options),
  });
}

// Transcribes an already-open stream, so a long call never has to sit in memory.
export async function transcribeFile(
  stream: Readable,
  options: TranscribeOptions = {}
): Promise<TranscribeResponse> {
  return client.listen.v1.media.transcribeFile(stream, buildParams(options));
}

// Transcribes a file by path. Prefer this over transcribeFile for anything read off disk.
//
// createReadStream reports failures as an async 'error' EVENT rather than a rejected
// promise, and an event has no relationship to the caller's try/catch — so a missing or
// unreadable file surfaced as an uncaughtException and killed the whole process mid-batch,
// defeating the per-call error isolation the pipeline is built around. Both steps below
// turn that event into a rejection the caller can actually handle.
export async function transcribeLocalFile(
  filePath: string,
  options: TranscribeOptions = {}
): Promise<TranscribeResponse> {
  // Missing file — the common case: an entry in meta.json with no audio beside it.
  await stat(filePath);

  // Failure after a successful open (permissions, removed volume, read error). Racing the
  // stream's error event keeps a late failure scoped to this call.
  const stream = createReadStream(filePath);
  const streamFailed = new Promise<never>((_resolve, reject) => {
    stream.once("error", reject);
  });

  return Promise.race([transcribeFile(stream, options), streamFailed]);
}
