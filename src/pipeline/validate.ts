import { createReadStream } from "node:fs";
import { BASELINE_MODEL, transcribeFile } from "../deepgram/client.js";
import { loadKeyterms } from "./transcribe.js";
import type { CallJob } from "./ingest.js";
import type { ValidationResult } from "../types/callRecord.js";

// normalizes text to compare two transcripts 
// TODO: extend later to remove filler words etc
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

// minimal Number of Insertions, Deletions and Substitutions to transform the hypothesis word list into the reference.
function editDistance(hyp: string[], ref: string[]): number {
  // +1: index 0 stands for the empty prefix (no word compared yet)
  // rows = hyp prefixes, columns = ref prefixes
  const rows = hyp.length + 1;
  const cols = ref.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  // edges: empty ref -> delete all from hyp, empty hyp -> insert all from ref
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    const currentRow = dp[i]!;
    const previousRow = dp[i - 1]!;
    for (let j = 1; j < cols; j++) {
      // words are equal -> no edit; otherwise the cheapest of the three operations + 1
      currentRow[j] =
        hyp[i - 1] === ref[j - 1]
          ? previousRow[j - 1]! // match: distance of prefixes unchanged
          : 1 +
            Math.min(
              previousRow[j]!, // deletion: hyp-word discard
              currentRow[j - 1]!, // insertion: ref-word insert
              previousRow[j - 1]! // substitution: word replace
            );
    }
  }

  // bottom right: full hyp and ref lists compared
  return dp[rows - 1]![cols - 1]!;
}

export function computeWer(hypothesisText: string, referenceText: string): number {
  const hyp = tokenize(hypothesisText);
  const ref = tokenize(referenceText);
  if (ref.length === 0) return 0;
  return editDistance(hyp, ref) / ref.length;
}

// Proportion of actually occurring terms that Deepgram correctly recognized is counted.
// Todo: add regex for terms ('NICE' would match 'nice' but shouldnt) -> word boundary
export function computeDomainTermRecall(
  deepgramText: string,
  baselineText: string,
  keyterms: string[]
): number {
  const deepgramLower = deepgramText.toLowerCase();
  const baselineLower = baselineText.toLowerCase();

  const mentionedEither = keyterms.filter(
    (term) => deepgramLower.includes(term.toLowerCase()) || baselineLower.includes(term.toLowerCase())
  );
  if (mentionedEither.length === 0) return 1; // no keyterm evidence in this call — vacuously satisfied

  const recognizedByDeepgram = mentionedEither.filter((term) => deepgramLower.includes(term.toLowerCase()));
  return recognizedByDeepgram.length / mentionedEither.length;
}

export async function runShadowValidation(
  job: CallJob,
  deepgramRedactedText: string
): Promise<ValidationResult | undefined> {
  try {
    const response = await transcribeFile(createReadStream(job.audioPath), { model: BASELINE_MODEL });
    if (!("results" in response)) return undefined;

    const baselineText = response.results.channels[0]?.alternatives?.[0]?.transcript ?? "";
    const keyterms = await loadKeyterms();

    return {
      baselineLabel: `deepgram:${BASELINE_MODEL}`,
      wer: computeWer(deepgramRedactedText, baselineText),
      domainTermRecall: computeDomainTermRecall(deepgramRedactedText, baselineText, keyterms),
    };
  } catch {
    return undefined;
  }
}
