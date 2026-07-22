import type { CallRecord } from "../types/callRecord.js";
import { CrmWebhookSink } from "./crmWebhookSink.js";
import { AnalyticsSink } from "./analyticsSink.js";
import { SplitSink } from "./splitSink.js";

// One interface for every destination. Adding, removing or traffic-splitting a destination
// must never require a change inside a pipeline stage — that is the whole contract.
export interface Sink {
  readonly name: string;
  publish(record: CallRecord): Promise<void>;
}

// Registry of the destinations that exist. New destinations are added here and nowhere else;
// no pipeline stage knows any of these names.
const FACTORIES: Record<string, () => Sink> = {
  crm: () => new CrmWebhookSink(),
  analytics: () => new AnalyticsSink(),
};

// Each DESTINATIONS entry is "name" or "name@percent" — "crm@25" routes a quarter of calls
// to the CRM. Keeping the share in the same string as the name means a migration ramp is one
// env var, not a second parallel config that can drift out of sync with it.
function parseEntry(entry: string): { name: string; sharePercent: number } {
  const [rawName, rawShare] = entry.split("@");
  const name = (rawName ?? "").trim();

  if (rawShare === undefined) return { name, sharePercent: 100 };

  const sharePercent = Number(rawShare.trim());
  if (!Number.isInteger(sharePercent) || sharePercent < 0 || sharePercent > 100) {
    throw new Error(
      `Invalid traffic split in DESTINATIONS: "${entry}" — expected an integer 0-100, e.g. "crm@25".`
    );
  }
  return { name, sharePercent };
}

// Translates the DESTINATIONS value into live Sink instances.
export function resolveSinks(destinations: string): Sink[] {
  const result: Sink[] = [];

  for (const part of destinations.split(",")) {
    if (part.trim() === "") continue;

    const { name, sharePercent } = parseEntry(part);
    const factory = FACTORIES[name];
    // Fail fast: a typo'd destination that was silently skipped would look exactly like a
    // successful run that published nothing.
    if (!factory) {
      throw new Error(`Unknown sink in DESTINATIONS: "${name}"`);
    }

    const sink = factory();
    result.push(sharePercent === 100 ? sink : new SplitSink(sink, sharePercent));
  }

  return result;
}
