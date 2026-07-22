import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWer, computeDomainTermRecall } from "./validate.js";

// These two numbers are shown to the customer as percentages in the dashboard and quoted
// in VALIDATION.md, so they are pinned here — a silent arithmetic regression would still
// render as a plausible-looking figure and nobody would catch it by looking.

test("computeWer: identical transcripts score 0", () => {
  assert.equal(computeWer("the quick brown fox", "the quick brown fox"), 0);
});

test("computeWer: ignores case and punctuation, not wording", () => {
  assert.equal(computeWer("The quick, brown fox!", "the quick brown fox"), 0);
});

test("computeWer: one substitution in four words is 0.25", () => {
  assert.equal(computeWer("the quick brown cat", "the quick brown fox"), 0.25);
});

test("computeWer: a missing word counts as one deletion", () => {
  assert.equal(computeWer("the quick brown", "the quick brown fox"), 0.25);
});

test("computeWer: an extra word counts as one insertion", () => {
  assert.equal(computeWer("the quick brown fox jumps", "the quick brown fox"), 0.25);
});

test("computeWer: normalizes by reference length, so it can exceed 1", () => {
  assert.equal(computeWer("a b c d", ""), 0); // empty reference is the guarded case
  assert.equal(computeWer("totally different words here", "one two"), 2);
});

test("computeDomainTermRecall: every spoken keyterm recognized scores 1", () => {
  const terms = ["webhook", "SSO"];
  assert.equal(
    computeDomainTermRecall("the webhook and SSO both work", "the webhook and SSO both work", terms),
    1
  );
});

test("computeDomainTermRecall: a term the baseline caught and Deepgram missed lowers the score", () => {
  const terms = ["QuantaFlow"];
  assert.equal(computeDomainTermRecall("I need quanta flow enabled", "I need QuantaFlow enabled", terms), 0);
});

test("computeDomainTermRecall: matches whole words only, so 'SLA' does not hit inside 'slash'", () => {
  // No real keyterm evidence in either transcript -> the vacuous branch, not a 0.
  assert.equal(computeDomainTermRecall("he typed a slash", "he typed a slash", ["SLA"]), 1);
});

test("computeDomainTermRecall: 'NICE' the vendor is not 'nice' the adjective", () => {
  // All-caps terms match case-sensitively: counting the English word as a brand mention
  // would inflate the metric on any call where someone says "that's nice".
  const terms = ["NICE", "webhook"];
  assert.equal(computeDomainTermRecall("the webhook is nice", "the webhook is NICE", terms), 0.5);
});

test("computeDomainTermRecall: returns the vacuous 1 when no keyterm is spoken at all", () => {
  // Documents the branch that made placeholder audio render a meaningless "100%".
  assert.equal(computeDomainTermRecall("unrelated chatter", "unrelated chatter", ["QuantaFlow"]), 1);
});
