import { BASELINE_MODEL, transcribeLocalFile } from "../deepgram/client.js";
import { loadKeyterms } from "./transcribe.js";
import type { CallJob } from "./ingest.js";
import type { ValidationResult } from "../types/callRecord.js";

// Normalizes both transcripts the same way before diffing them, so the two engines are not
// penalized for stylistic differences that have nothing to do with recognition accuracy.
// Filler words ("um", "uh") are deliberately KEPT: dropping them is a judgement call that
// changes the metric, and VALIDATION.md section 1 commits to deciding that jointly with the
// customer rather than baking a preference in here.
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

// Matches a keyterm only as a whole word. Plain substring matching inflated this metric —
// "SLA" hit inside "slash", "SSO" inside "ssology" — and since the result is shown to the
// customer as a percentage, a false positive overstates recognition quality.
//
// Case matters for the all-caps terms specifically: "NICE" is a competitor's name, "nice"
// is an ordinary English word, and counting the latter as a recognized brand mention is
// the exact failure the original TODO called out. So all-caps terms are matched
// case-sensitively; everything else (product names, "webhook") case-insensitively.
// Terms are regex-escaped because the list is user-editable (src/config/terms.json).
function mentionsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const caseSensitive = term === term.toUpperCase() && /[A-Z]/.test(term);
  // \b anchors need a word character on the relevant side; terms that start or end with
  // punctuation get a plain containment check instead of a broken anchor.
  if (!/^\w/.test(term) || !/\w$/.test(term)) {
    return caseSensitive ? text.includes(term) : text.toLowerCase().includes(term.toLowerCase());
  }
  return new RegExp(`\\b${escaped}\\b`, caseSensitive ? "" : "i").test(text);
}

// Proportion of the keyterms actually spoken in this call that Deepgram recognized.
export function computeDomainTermRecall(
  deepgramText: string,
  baselineText: string,
  keyterms: string[]
): number {
  const mentionedEither = keyterms.filter(
    (term) => mentionsTerm(deepgramText, term) || mentionsTerm(baselineText, term)
  );
  // No keyterm evidence at all. Returning 1 renders as a flattering "100%" in the dashboard
  // while measuring nothing — which is exactly what happened while the pipeline was pointed
  // at placeholder audio containing none of DataVoice's vocabulary. Kept as the neutral
  // value, but callers should treat it as "not applicable", not as a passing score.
  if (mentionedEither.length === 0) return 1;

  const recognizedByDeepgram = mentionedEither.filter((term) => mentionsTerm(deepgramText, term));
  return recognizedByDeepgram.length / mentionedEither.length;
}

export async function runShadowValidation(
  job: CallJob,
  deepgramRedactedText: string
): Promise<ValidationResult | undefined> {
  try {
    const response = await transcribeLocalFile(job.audioPath, { model: BASELINE_MODEL });
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
