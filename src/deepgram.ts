import { DeepgramClient } from "@deepgram/sdk";
import type { Readable } from "node:stream";

export type TranscribeResponse = Awaited<
  ReturnType<DeepgramClient["listen"]["v1"]["media"]["transcribeFile"]>
>;

export interface TranscribeOptions {
  keyterms?: string[];
  model?: string;
  includeIntelligence?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type TranscribeFn = (
  stream: Readable,
  options?: TranscribeOptions
) => Promise<TranscribeResponse>;

export const MODEL = "nova-3" as const;
export const BASELINE_MODEL = "base" as const;

const DEFAULT_TIMEOUT_MS = 120_000;

let client: DeepgramClient | undefined;

function getClient(): DeepgramClient {
  client ??= new DeepgramClient();
  return client;
}

function buildParams(options: TranscribeOptions) {
  return {
    model: options.model ?? MODEL,
    diarize: true,
    smart_format: true,
    // paragraphs carry speaker ids used to build TranscriptSegment[]
    paragraphs: true,
    redact: "pii",
    language: "en",
    ...(options.keyterms?.length ? { keyterm: options.keyterms } : {}),
    ...(options.includeIntelligence ? { summarize: "v2", topics: true } : {}),
  };
}

export async function transcribeFile(
  stream: Readable,
  options: TranscribeOptions = {}
): Promise<TranscribeResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return getClient().listen.v1.media.transcribeFile(stream, buildParams(options), {
    timeoutInSeconds: Math.ceil(timeoutMs / 1000),
    abortSignal: options.signal ?? AbortSignal.timeout(timeoutMs),
    maxRetries: 0,
  });
}
