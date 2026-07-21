import type { Sink } from "./sink.js";
import type { CallRecord } from "../types/callRecord.js";

// sends a complete CallRecord to the (Mock-)CRM - stands in for "data lands in the real CRM system"
export class CrmWebhookSink implements Sink {
  readonly name = "crm";

  async publish(record: CallRecord): Promise<void> {
    const url = process.env.CRM_WEBHOOK_URL;
    if (!url) throw new Error("CRM_WEBHOOK_URL is not set");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });

    if (!res.ok) {
      throw new Error(`CRM webhook responded with ${res.status}`);
    }

    const ack: unknown = await res.json();
    console.log(`[crm] published ${record.callId} — ack:`, ack);
  }
}
