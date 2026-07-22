import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSinks } from "./sink.js";

// resolveSinks is the whole of the "destinations are activated by config, never by editing
// a pipeline stage" promise (CLAUDE.md section 4). If it silently dropped a destination,
// records would stop reaching the CRM with no error anywhere.

test("resolveSinks: DESTINATIONS order is preserved", () => {
  assert.deepEqual(
    resolveSinks("crm,analytics").map((s) => s.name),
    ["crm", "analytics"]
  );
});

test("resolveSinks: a single destination activates only that one", () => {
  assert.deepEqual(
    resolveSinks("analytics").map((s) => s.name),
    ["analytics"]
  );
});

test("resolveSinks: tolerates whitespace and trailing separators", () => {
  assert.deepEqual(
    resolveSinks(" crm , analytics , ").map((s) => s.name),
    ["crm", "analytics"]
  );
});

test("resolveSinks: an empty value publishes nowhere rather than defaulting", () => {
  assert.deepEqual(resolveSinks(""), []);
});

test("resolveSinks: an unknown destination fails loudly instead of being skipped", () => {
  // Fail fast is deliberate: a typo'd DESTINATIONS silently dropping the CRM would look
  // exactly like a working run that published nothing.
  assert.throws(() => resolveSinks("crm,crn"), /Unknown sink in DESTINATIONS: "crn"/);
});
