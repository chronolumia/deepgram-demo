import type { CallRecord } from "../types/callRecord.js";
import { CrmWebhookSink } from "./crmWebhookSink.js";
import { AnalyticsSink } from "./analyticsSink.js";

// one interface for all destinations (CRM, Analytics, etc..)
export interface Sink {
  readonly name: string;
  publish(record: CallRecord): Promise<void>;
}

// translates the DESTINATIONS value ("crm,analytics") into actual Sink instances
export function resolveSinks(destinations: string): Sink[] {
  const result: Sink[] = [];
  const parts = destinations.split(",");
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]!.trim();
    if (name === "") continue;
    if (name === "crm") {
      result.push(new CrmWebhookSink());
    } else if (name === "analytics") {
      result.push(new AnalyticsSink());
    } else {
      throw new Error(`Unknown sink in DESTINATIONS: "${name}"`);
    }
  }
  return result;
}

// TODO: add a traffic-split for the destinations
