import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findOfficialResetConfirmation,
  OFFICIAL_CORROBORATION_WINDOW_MS,
} from "../app/lib/reset-corroboration.ts";

const detectedAt = "2026-07-25T19:21:32.000Z";

function event(overrides = {}) {
  return {
    occurredAt: "2026-07-25T19:17:12.695Z",
    status: "official",
    title: "Usage limits reset",
    sourceName: "Official announcement",
    sourceUrl: "https://example.com/official",
    ...overrides,
  };
}

test("matches the closest official source to a locally detected reset", () => {
  const fartherMatch = event({
    occurredAt: "2026-07-25T17:00:00.000Z",
    sourceUrl: "https://example.com/farther",
  });
  const closestMatch = event();

  assert.deepEqual(findOfficialResetConfirmation(detectedAt, [fartherMatch, closestMatch]), {
    occurredAt: closestMatch.occurredAt,
    title: closestMatch.title,
    sourceName: closestMatch.sourceName,
    sourceUrl: closestMatch.sourceUrl,
  });
});

test("does not corroborate with a non-official or unlinked source", () => {
  assert.equal(
    findOfficialResetConfirmation(detectedAt, [
      event({ status: "community" }),
      event({ sourceUrl: undefined }),
    ]),
    null,
  );
});

test("does not associate an official post outside the correlation window", () => {
  const occurredAt = new Date(
    Date.parse(detectedAt) - OFFICIAL_CORROBORATION_WINDOW_MS - 1,
  ).toISOString();

  assert.equal(findOfficialResetConfirmation(detectedAt, [event({ occurredAt })]), null);
});

test("returns no confirmation for an invalid local timestamp", () => {
  assert.equal(findOfficialResetConfirmation("not-a-date", [event()]), null);
});
