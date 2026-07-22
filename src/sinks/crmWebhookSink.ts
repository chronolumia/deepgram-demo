import type { Sink } from "./sink.js";
import type { CallRecord } from "../types/callRecord.js";

// POSTs a complete CallRecord to the (mock) CRM — stands in for "the data lands in the real
// CRM system". The CallRecord is sent as-is: the CRM receives our vendor-neutral contract,
// never Deepgram's response shape, which is what makes the engine swappable.

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

// Retrying a 5xx or a dropped connection is safe here only because the request carries an
// idempotency key: the CRM can recognize a replay of a call it already stored. Without that
// guarantee a retry risks duplicating a support call in the customer's CRM, which is worse
// than losing it — so the key and the retry belong together, not separately.
function isRetryable(status: number): boolean {
  // 5xx is the server's problem and may pass; 429 is explicit backpressure. A 4xx is our
  // bug (bad payload, bad URL) and will fail identically every time — retrying just delays
  // the error and triples the load.
  return status >= 500 || status === 429;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CrmWebhookSink implements Sink {
  readonly name = "crm";

  async publish(record: CallRecord): Promise<void> {
    const url = process.env.CRM_WEBHOOK_URL;
    if (!url) throw new Error("CRM_WEBHOOK_URL is not set");

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Stable across retries AND across re-runs of the same call, so the CRM can
            // dedupe either one.
            "Idempotency-Key": record.callId,
          },
          body: JSON.stringify(record),
          // Without a timeout a hung CRM stalls the entire batch indefinitely — one
          // unresponsive destination should cost one call, not the run.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (res.ok) {
          const ack: unknown = await res.json();
          console.log(`[crm] published ${record.callId} — ack:`, ack);
          return;
        }

        lastError = new Error(`CRM webhook responded with ${res.status}`);
        if (!isRetryable(res.status)) throw lastError;
      } catch (err) {
        // Network failure or timeout — both are worth another attempt.
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.message.startsWith("CRM webhook responded with 4")) throw lastError;
      }

      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff: a CRM that is down or rate-limiting recovers faster if the
        // retries spread out instead of hammering it three times in a row.
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        console.log(`[crm] retrying ${record.callId} (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
      }
    }

    throw lastError ?? new Error(`CRM publish failed for ${record.callId}`);
  }
}
