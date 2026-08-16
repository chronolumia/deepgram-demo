import { createReadStream } from "node:fs";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { loadConfig, loadKeyterms } from "./config.js";
import {
  BASELINE_MODEL,
  transcribeFile,
  type TranscribeFn,
  type TranscribeOptions,
  type TranscribeResponse,
} from "./deepgram.js";
import { failedRecord, normalize, type CallJob, type CallRecord } from "./record.js";
import { computeDomainTermRecall, computeWer } from "./validate.js";

interface SampleMetaEntry {
  file: string;
  callId: string;
  agentId?: string;
  startedAt: string;
}

export interface Publisher {
  name: string;
  publish(record: CallRecord): Promise<void>;
}

export async function discoverJobs(samplesDir: string): Promise<CallJob[]> {
  const raw = await readFile(path.join(samplesDir, "meta.json"), "utf-8");
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries)) {
    throw new Error("samples/meta.json must be a JSON array");
  }

  return entries.map((entry: SampleMetaEntry) => ({
    callId: entry.callId,
    audioPath: path.join(samplesDir, entry.file),
    agentId: entry.agentId,
    startedAt: entry.startedAt,
  }));
}

async function publishCrm(record: CallRecord, url: string, timeoutMs: number): Promise<void> {
  if (!url) throw new Error("CRM_WEBHOOK_URL is not set");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`CRM webhook responded with ${res.status}`);
  }

  await res.json();
  console.log(`[crm] published ${record.callId}`);
}

async function publishAnalytics(record: CallRecord, outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await appendFile(outPath, JSON.stringify(record) + "\n", "utf-8");
}

export function resolvePublishers(cfg: AppConfig): Publisher[] {
  const result: Publisher[] = [];
  for (const part of cfg.destinations.split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if (name === "crm") {
      result.push({
        name: "crm",
        publish: (record) => publishCrm(record, cfg.crmWebhookUrl, cfg.crmTimeoutMs),
      });
    } else if (name === "analytics") {
      result.push({
        name: "analytics",
        publish: (record) => publishAnalytics(record, cfg.analyticsPath),
      });
    } else {
      throw new Error(`Unknown sink in DESTINATIONS: "${name}"`);
    }
  }
  return result;
}

async function transcribeJob(
  job: CallJob,
  options: TranscribeOptions,
  transcribe: TranscribeFn
): Promise<TranscribeResponse> {
  await access(job.audioPath);
  const stream = createReadStream(job.audioPath);
  try {
    return await transcribe(stream, options);
  } finally {
    stream.destroy();
  }
}

async function shadowValidate(
  job: CallJob,
  deepgramText: string,
  keyterms: string[],
  transcribe: TranscribeFn,
  timeoutMs: number
): Promise<CallRecord["validation"]> {
  try {
    const response = await transcribeJob(job, { model: BASELINE_MODEL, timeoutMs }, transcribe);
    if (!("results" in response)) {
      console.warn(`[validate] ${job.callId}: baseline returned no results`);
      return undefined;
    }

    const baselineText = response.results.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    return {
      baselineLabel: `deepgram:${BASELINE_MODEL}`,
      wer: computeWer(deepgramText, baselineText),
      domainTermRecall: computeDomainTermRecall(deepgramText, baselineText, keyterms),
    };
  } catch (err) {
    console.warn(`[validate] ${job.callId}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

async function processJob(
  job: CallJob,
  cfg: AppConfig,
  keyterms: string[],
  transcribe: TranscribeFn
): Promise<CallRecord> {
  try {
    const response = await transcribeJob(
      job,
      {
        keyterms,
        includeIntelligence: cfg.intelligenceEnabled,
        timeoutMs: cfg.deepgramTimeoutMs,
      },
      transcribe
    );
    const record = normalize(job, response);
    if (!record.error && cfg.shadowValidation) {
      record.validation = await shadowValidate(
        job,
        record.transcript.redactedText,
        keyterms,
        transcribe,
        cfg.deepgramTimeoutMs
      );
    }
    return record;
  } catch (err) {
    return failedRecord(job, err);
  }
}

async function publishToSinks(record: CallRecord, publishers: Publisher[]): Promise<void> {
  for (const publisher of publishers) {
    try {
      await publisher.publish(record);
    } catch (err) {
      console.error(
        `[${publisher.name}] publish failed for ${record.callId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export interface RunBatchOptions {
  config?: AppConfig;
  transcribe?: TranscribeFn;
}

export async function runBatch(options: RunBatchOptions = {}): Promise<CallRecord[]> {
  const cfg = options.config ?? loadConfig();
  const transcribe = options.transcribe ?? transcribeFile;
  const jobs = await discoverJobs(cfg.samplesDir);
  const publishers = resolvePublishers(cfg);
  const keyterms = loadKeyterms(cfg.termsPath);

  const results: CallRecord[] = [];
  for (const job of jobs) {
    const record = await processJob(job, cfg, keyterms, transcribe);
    await publishToSinks(record, publishers);
    results.push(record);
  }
  return results;
}
