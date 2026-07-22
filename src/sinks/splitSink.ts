import type { Sink } from "./sink.js";
import type { CallRecord } from "../types/callRecord.js";

// The gradual-migration story in code: a wrapper that forwards only a share of calls to the
// sink it wraps. Ramping 5% -> 25% -> 50% -> 100% is an env change (DESTINATIONS=crm@25),
// and rollback is setting the number back — no data migration, no pipeline-stage edit.
//
// It is a wrapper rather than a flag inside CrmWebhookSink for the reason the Sink interface
// exists at all: splitting must compose with ANY destination, present or future, without
// that destination knowing it is being split.

// Routing is deterministic on callId, never random. Three reasons this matters more than it
// looks: re-running a batch routes every call the same way (so a retry can't double-publish
// a call that already landed); raising the share is purely additive, so a call in the 5%
// cohort stays in the 25% cohort instead of being reshuffled out; and a demo produces the
// same split twice in a row, which a random sample would not.
//
// FNV-1a: a few lines, no dependency, and spreads short similar keys ("call-004",
// "call-005") across buckets far better than summing char codes.
function bucketFor(callId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < callId.length; i++) {
    hash ^= callId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 reinterprets the sign bit as magnitude — Math.imul yields a signed 32-bit int,
  // and a negative modulo would push valid calls out of every cohort.
  return (hash >>> 0) % 100;
}

export function routesToSink(callId: string, sharePercent: number): boolean {
  if (sharePercent >= 100) return true;
  if (sharePercent <= 0) return false;
  return bucketFor(callId) < sharePercent;
}

export class SplitSink implements Sink {
  readonly name: string;

  constructor(
    private readonly inner: Sink,
    private readonly sharePercent: number
  ) {
    // Carries the share so pipeline logs say "crm@25" — during a ramp, "which cohort was
    // this run?" is the first question asked about any published record.
    this.name = `${inner.name}@${sharePercent}%`;
  }

  async publish(record: CallRecord): Promise<void> {
    if (!routesToSink(record.callId, this.sharePercent)) {
      // Logged, not silent: a call absent from the CRM should be explainable as "not in the
      // cohort" rather than looking like a dropped record.
      console.log(`[${this.name}] skipped ${record.callId} — not in cohort`);
      return;
    }
    await this.inner.publish(record);
  }
}
