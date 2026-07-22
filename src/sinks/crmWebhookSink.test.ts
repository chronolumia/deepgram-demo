import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CrmWebhookSink } from "./crmWebhookSink.js";
import type { CallRecord } from "../types/callRecord.js";

// The CRM sink is the one place the pipeline talks to a system it does not control, so its
// failure handling is the part most worth pinning. fetch is stubbed rather than mocked with
// a library — it is a global, and swapping it keeps these tests offline and instant.

const record: CallRecord = {
  callId: "call-004",
  source: { audioUri: "samples/call-004.mp3", startedAt: "2026-07-13T09:12:00Z", durationSec: 58 },
  transcript: { segments: [], redactedText: "hello" },
  intelligence: {},
  processing: { engine: "deepgram", model: "nova-3", processedAt: "2026-07-13T09:13:00Z" },
  schemaVersion: 1,
};

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(responder: (attempt: number) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return responder(calls.length);
  }) as typeof fetch;
}

const ok = () => new Response(JSON.stringify({ received: true }), { status: 200 });

beforeEach(() => {
  process.env.CRM_WEBHOOK_URL = "http://localhost:3000/mock-crm";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("CrmWebhookSink: posts the CallRecord and accepts the ack", async () => {
  stubFetch(ok);
  await new CrmWebhookSink().publish(record);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://localhost:3000/mock-crm");
  assert.equal(JSON.parse(String(calls[0]?.init.body)).callId, "call-004");
});

test("CrmWebhookSink: sends a stable idempotency key so a retry cannot duplicate a call", async () => {
  stubFetch(ok);
  await new CrmWebhookSink().publish(record);

  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["Idempotency-Key"], "call-004");
});

test("CrmWebhookSink: retries a 5xx and succeeds when the CRM recovers", async () => {
  stubFetch((attempt) => (attempt < 3 ? new Response("", { status: 503 }) : ok()));

  await new CrmWebhookSink().publish(record);
  assert.equal(calls.length, 3);
});

test("CrmWebhookSink: gives up after the attempt limit rather than retrying forever", async () => {
  stubFetch(() => new Response("", { status: 500 }));

  await assert.rejects(() => new CrmWebhookSink().publish(record), /responded with 500/);
  assert.equal(calls.length, 3);
});

test("CrmWebhookSink: does not retry a 4xx, which would fail identically every time", async () => {
  stubFetch(() => new Response("", { status: 400 }));

  await assert.rejects(() => new CrmWebhookSink().publish(record), /responded with 400/);
  assert.equal(calls.length, 1);
});

test("CrmWebhookSink: fails loudly when CRM_WEBHOOK_URL is unset", async () => {
  delete process.env.CRM_WEBHOOK_URL;
  stubFetch(ok);

  await assert.rejects(() => new CrmWebhookSink().publish(record), /CRM_WEBHOOK_URL is not set/);
  assert.equal(calls.length, 0);
});
