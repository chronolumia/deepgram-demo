import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import type { TranscribeFn, TranscribeResponse } from "./deepgram.js";
import { resolvePublishers, runBatch } from "./pipeline.js";

const termsPath = path.join(process.cwd(), "src", "terms.json");

function fixtureResponse(transcript = "Hello from DataVoice"): TranscribeResponse {
  return {
    metadata: { duration: 2 },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript,
              paragraphs: {
                paragraphs: [
                  {
                    speaker: 0,
                    start: 0,
                    end: 2,
                    sentences: [{ text: transcript }],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  } as TranscribeResponse;
}

async function makeSamples(callIds: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dv-samples-"));
  const entries = [];
  for (const callId of callIds) {
    const file = `${callId}.wav`;
    await writeFile(path.join(dir, file), "fake-audio");
    entries.push({
      file,
      callId,
      agentId: "agent-07",
      startedAt: "2026-06-29T14:32:00Z",
    });
  }
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(entries));
  return dir;
}

function configFor(samplesDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig(),
    deepgramApiKey: "test",
    destinations: "",
    crmWebhookUrl: "",
    intelligenceEnabled: false,
    shadowValidation: false,
    samplesDir,
    termsPath,
    analyticsPath: path.join(samplesDir, "analytics.jsonl"),
    ...overrides,
  };
}

test("happy path: stubbed transcribe produces a CallRecord per job", async () => {
  const samplesDir = await makeSamples(["call-a", "call-b"]);
  const transcribe: TranscribeFn = async () => fixtureResponse();

  const records = await runBatch({ config: configFor(samplesDir), transcribe });

  assert.equal(records.length, 2);
  assert.equal(records[0]?.callId, "call-a");
  assert.equal(records[0]?.error, undefined);
  assert.equal(records[0]?.transcript.redactedText, "Hello from DataVoice");
  assert.equal(records[0]?.transcript.segments[0]?.speaker, "agent");
  assert.equal(records[0]?.validation, undefined);
});

test("a Deepgram failure on one call does not stop the batch", async () => {
  const samplesDir = await makeSamples(["call-a", "call-b"]);
  let n = 0;
  const transcribe: TranscribeFn = async () => {
    n += 1;
    if (n === 1) throw new Error("timed out");
    return fixtureResponse("ok");
  };

  const records = await runBatch({ config: configFor(samplesDir), transcribe });

  assert.equal(records.length, 2);
  assert.equal(records[0]?.error, "timed out");
  assert.equal(records[1]?.error, undefined);
  assert.equal(records[1]?.transcript.redactedText, "ok");
});

test("passes the configured timeout through to transcribe", async () => {
  const samplesDir = await makeSamples(["call-a"]);
  const seen: Array<number | undefined> = [];
  const transcribe: TranscribeFn = async (_stream, options) => {
    seen.push(options?.timeoutMs);
    return fixtureResponse();
  };

  await runBatch({
    config: configFor(samplesDir, { deepgramTimeoutMs: 5000 }),
    transcribe,
  });

  assert.deepEqual(seen, [5000]);
});

test("missing audio becomes a per-call error", async () => {
  const samplesDir = await mkdtemp(path.join(os.tmpdir(), "dv-samples-"));
  await writeFile(
    path.join(samplesDir, "meta.json"),
    JSON.stringify([
      {
        file: "missing.wav",
        callId: "call-missing",
        startedAt: "2026-06-29T14:32:00Z",
      },
    ])
  );

  const transcribe: TranscribeFn = async () => {
    throw new Error("should not be called");
  };

  const records = await runBatch({ config: configFor(samplesDir), transcribe });
  assert.equal(records.length, 1);
  assert.match(records[0]?.error ?? "", /ENOENT|no such file/i);
});

test("malformed meta.json fails the batch", async () => {
  const samplesDir = await mkdtemp(path.join(os.tmpdir(), "dv-samples-"));
  await writeFile(path.join(samplesDir, "meta.json"), "{not-json");

  await assert.rejects(
    () => runBatch({ config: configFor(samplesDir), transcribe: async () => fixtureResponse() }),
    SyntaxError
  );
});

test("meta.json that is not an array fails the batch", async () => {
  const samplesDir = await mkdtemp(path.join(os.tmpdir(), "dv-samples-"));
  await writeFile(path.join(samplesDir, "meta.json"), "{}");

  await assert.rejects(
    () => runBatch({ config: configFor(samplesDir), transcribe: async () => fixtureResponse() }),
    /must be a JSON array/
  );
});

test("DESTINATIONS selects publishers and rejects unknown names", () => {
  const cfg = configFor("/tmp", { destinations: "crm, analytics" });
  assert.deepEqual(
    resolvePublishers(cfg).map((p) => p.name),
    ["crm", "analytics"]
  );
  assert.throws(
    () => resolvePublishers(configFor("/tmp", { destinations: "kafka" })),
    /Unknown sink in DESTINATIONS: "kafka"/
  );
});

test("shadow validation is off by default and on when flagged", async () => {
  const samplesDir = await makeSamples(["call-a"]);
  const models: Array<string | undefined> = [];
  const transcribe: TranscribeFn = async (_stream, options) => {
    models.push(options?.model);
    return fixtureResponse();
  };

  await runBatch({ config: configFor(samplesDir), transcribe });
  assert.deepEqual(models, [undefined]);

  models.length = 0;
  await runBatch({
    config: configFor(samplesDir, { shadowValidation: true }),
    transcribe,
  });
  assert.deepEqual(models, [undefined, "base"]);
});
