import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDomainTermRecall, computeWer } from "./validate.js";

test("computeWer is substitutions over reference length", () => {
  assert.equal(computeWer("a b c", "a x c"), 1 / 3);
  assert.equal(computeWer("a b c", "a b c"), 0);
  assert.equal(computeWer("hello", ""), 0);
});

test("domain-term recall uses word boundaries against the baseline", () => {
  assert.equal(computeDomainTermRecall("the NICE migration", "NICE migration", ["NICE"]), 1);
  assert.equal(computeDomainTermRecall("nicely done", "NICE rocks", ["NICE"]), 0);
  assert.equal(computeDomainTermRecall("API key expired", "rotate your API key", ["API key"]), 1);
  assert.equal(computeDomainTermRecall("hello", "hello", ["NICE"]), 1);
});

test("hallucinated keyterms do not inflate recall", () => {
  assert.equal(
    computeDomainTermRecall("QuantaFlow is great", "we talked about SSO", ["QuantaFlow", "SSO"]),
    0
  );
  assert.equal(computeDomainTermRecall("plain call", "plain call", ["QuantaFlow"]), 1);
});
