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
      audioUri: job.audioPath,
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
    // Nur bei einem erfolgreich transkribierten Call lohnt sich ein Baseline-Vergleich
    if (!record.error) {
      record.validation = await runShadowValidation(job, record.transcript.redactedText);
    }
    return record;
  } catch (err) {
    // Fail per call, not per batch
    return errorRecord(job, err);
  }
}

// sends a complete CallRecord to each configured sink. 
async function publishToSinks(record: CallRecord, sinks: Sink[]): Promise<void> {
  for (const sink of sinks) {
    try {
      await sink.publish(record);
    } catch (err) {
      console.error(`[${sink.name}] publish failed for ${record.callId}:`, err instanceof Error ? err.message : err);
    }
  }
}


// TODO: for production, replace with a concurrency-limited worker pool or queue.
async function runSequentially(jobs: CallJob[], sinks: Sink[]): Promise<CallRecord[]> {
  const results: CallRecord[] = [];
  for (const job of jobs) {
    const record = await processJob(job);
    await publishToSinks(record, sinks);
    results.push(record);
  }
  return results;
}

export async function runBatch(): Promise<CallRecord[]> {
  const jobs = await discoverJobs();
  const sinks = resolveSinks(process.env.DESTINATIONS ?? "crm,analytics");
  return runSequentially(jobs, sinks);
}
