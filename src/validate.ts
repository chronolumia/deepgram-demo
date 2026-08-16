export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(hyp: string[], ref: string[]): number {
  const rows = hyp.length + 1;
  const cols = ref.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    const currentRow = dp[i]!;
    const previousRow = dp[i - 1]!;
    for (let j = 1; j < cols; j++) {
      currentRow[j] =
        hyp[i - 1] === ref[j - 1]
          ? previousRow[j - 1]!
          : 1 + Math.min(previousRow[j]!, currentRow[j - 1]!, previousRow[j - 1]!);
    }
  }

  return dp[rows - 1]![cols - 1]!;
}

export function computeWer(hypothesisText: string, referenceText: string): number {
  const hyp = tokenize(hypothesisText);
  const ref = tokenize(referenceText);
  if (ref.length === 0) return 0;
  return editDistance(hyp, ref) / ref.length;
}

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function computeDomainTermRecall(
  deepgramText: string,
  baselineText: string,
  keyterms: string[]
): number {
  const mentionedInBaseline = keyterms.filter((term) => hasTerm(baselineText, term));
  if (mentionedInBaseline.length === 0) return 1;

  const recognized = mentionedInBaseline.filter((term) => hasTerm(deepgramText, term));
  return recognized.length / mentionedInBaseline.length;
}
