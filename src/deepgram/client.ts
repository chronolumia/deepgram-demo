import { DeepgramClient } from "@deepgram/sdk";
import type { Readable } from "node:stream";

// Note: every transcription option lives here so a vendor swap touches one file.
const client = new DeepgramClient(); // reads DEEPGRAM_API_KEY from env

// v5.5.0 doesn't export MediaTranscribeResponse from the package root, so we derive it from the method itself
export type TranscribeResponse = Awaited<
  ReturnType<typeof client.listen.v1.media.transcribeUrl>
>;

export interface TranscribeOptions {
  keyterms?: string[];
  model?: string;
  includeIntelligence?: boolean;
}

export const MODEL = "nova-3" as const;

// der Baseline als Ersatz für bisherigen vendor.
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

// first test 
export async function transcribeUrl(
  url: string,
  options: TranscribeOptions = {}
): Promise<TranscribeResponse> {
  return client.listen.v1.media.transcribeUrl({
    url,
    ...buildParams(options),
  });
}

// transcirbes a local file
export async function transcribeFile(
  stream: Readable,
  options: TranscribeOptions = {}
): Promise<TranscribeResponse> {
  return client.listen.v1.media.transcribeFile(stream, buildParams(options));
}
