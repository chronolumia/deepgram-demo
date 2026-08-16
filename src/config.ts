import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

export interface AppConfig {
  port: number;
  deepgramApiKey: string;
  destinations: string;
  crmWebhookUrl: string;
  intelligenceEnabled: boolean;
  shadowValidation: boolean;
  samplesDir: string;
  publicDir: string;
  analyticsPath: string;
  termsPath: string;
  deepgramTimeoutMs: number;
  crmTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT) || 3000,
    deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? "",
    destinations: process.env.DESTINATIONS ?? "crm,analytics",
    crmWebhookUrl: process.env.CRM_WEBHOOK_URL ?? "",
    intelligenceEnabled: process.env.INTELLIGENCE_ENABLED === "true",
    shadowValidation: process.env.SHADOW_VALIDATION === "true",
    samplesDir: path.join(ROOT, "samples"),
    publicDir: path.join(ROOT, "public"),
    analyticsPath: path.join(ROOT, "data", "analytics.jsonl"),
    termsPath: path.join(ROOT, "src", "terms.json"),
    deepgramTimeoutMs: Number(process.env.DEEPGRAM_TIMEOUT_MS) || 120_000,
    crmTimeoutMs: Number(process.env.CRM_TIMEOUT_MS) || 10_000,
  };
}

export function loadKeyterms(termsPath: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(termsPath, "utf-8"));
  if (!Array.isArray(parsed) || parsed.some((term) => typeof term !== "string")) {
    throw new Error(`keyterm list at ${termsPath} must be a JSON array of strings`);
  }
  return parsed;
}
