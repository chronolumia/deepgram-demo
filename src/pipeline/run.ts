import { discoverJobs, type CallJob } from "./ingest.js";
import { transcribeCall } from "./transcribe.js";
import { normalize } from "./normalize.js";
import { runShadowValidation } from "./validate.js";
import { MODEL } from "../deepgram/client.js";
import { resolveSinks, type Sink } from "../sinks/sink.js";
import type { CallRecord } from "../types/callRecord.js";

// builds an "error CallRecord" for a call that failed somewhere in Stage 2 or 3. (because the audio file is missing or Deepgram returns an error)
// The goal is to ensure that such a call still appears as a normal `CallRecord` in the result (with empty transcript + `error` field set)
function errorRecord(job: CallJob, err: unknown): CallRecord {
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
    processing: {
      engine: "deepgram",
      model: MODEL,
      processedAt: new Date().toISOString(),
    },
    error: err instanceof Error ? err.message : JSON.stringify(err),
    schemaVersion: 1,
  };
}

// processes a single call completely (transcribe, normalize, shadow validation) and guarantees that this function never throws, it always returns a CallRecord
async function processJob(job: CallJob): Promise<CallRecord> {
  try {
    const response = await transcribeCall(job);
    const record = normalize(job, response);
    // Opt-in, because a shadow run costs a SECOND full transcription of the same audio
    // (validate.ts re-sends it against the baseline model) — roughly doubling both spend
    // and wall-clock time per batch. Only worth it on a call that transcribed cleanly.
    if (!record.error && process.env.VALIDATION_ENABLED === "true") {
      record.validation = await runShadowValidation(job, record.transcript.redactedText);
    }
    return record;
  } catch (err) {
    // Fail per call, not per batch
    return errorRecord(job, err);
  }
}

// Sends a complete CallRecord to every configured sink. Exported for tests: "one failing
// destination must not cost the others, or the batch" is behaviour worth pinning.
export async function publishToSinks(record: CallRecord, sinks: Sink[]): Promise<void> {
  for (const sink of sinks) {
    try {
      await sink.publish(record);
    } catch (err) {
      // Logged, not rethrown: a broken analytics store should not stop the CRM from
      // receiving the same call, and neither should stop the remaining calls.
      console.error(
        `[${sink.name}] publish failed for ${record.callId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

// Reads CONCURRENCY, defaulting to 1. Sequential stays the default deliberately: it is what
// CLAUDE.md section 9 specifies, it keeps the demo's log output readable in call order, and
// it cannot trip Deepgram's rate limits. The knob exists because 10,000 h/month cannot be
// processed one call at a time, so the ceiling should be a config change rather than a
// rewrite — a real deployment replaces this with a queue and N workers.
function resolveConcurrency(): number {
  const raw = Number(process.env.CONCURRENCY ?? 1);
  if (!Number.isInteger(raw) || raw < 1) {
    throw new Error(`Invalid CONCURRENCY: "${process.env.CONCURRENCY}" — expected an integer >= 1.`);
  }
  return raw;
}

// Fixed pool of workers pulling from a shared cursor. Results are written back by index so
// the output stays in meta.json order regardless of which call finishes first — the
// dashboard and the analytics store both read better in a stable order.
async function runJobs(jobs: CallJob[], sinks: Sink[], concurrency: number): Promise<CallRecord[]> {
  const results = new Array<CallRecord>(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index]!;
      const record = await processJob(job);
      await publishToSinks(record, sinks);
      results[index] = record;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

export async function runBatch(): Promise<CallRecord[]> {
  const jobs = await discoverJobs();
  const sinks = resolveSinks(process.env.DESTINATIONS ?? "crm,analytics");
  return runJobs(jobs, sinks, resolveConcurrency());
}
