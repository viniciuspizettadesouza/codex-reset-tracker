import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertEvent, deriveStatus, computeDaysEarly, isEarly } from "../scripts/lib/events.mjs";

const base = {
  scheduledAt: "2026-07-27T00:00:00Z",
  reportedAt: "2026-07-24T00:00:00Z",
  status: "suspected",
  title: "t",
  reportCount: 1,
  sourceName: "s",
  description: "d",
};

test("computeDaysEarly returns rounded days, null when not early", () => {
  assert.equal(computeDaysEarly("2026-07-22T00:00:00Z", "2026-07-27T00:00:00Z"), 5);
  assert.equal(computeDaysEarly("2026-07-28T00:00:00Z", "2026-07-27T00:00:00Z"), null);
  assert.equal(computeDaysEarly("2026-07-22T00:00:00Z", null), null);
});

test("isEarly mirrors computeDaysEarly", () => {
  assert.equal(isEarly("2026-07-22T00:00:00Z", "2026-07-27T00:00:00Z"), true);
  assert.equal(isEarly("2026-07-27T00:00:00Z", "2026-07-27T00:00:00Z"), false);
});

test("deriveStatus thresholds", () => {
  assert.equal(deriveStatus(1, false), "suspected");
  assert.equal(deriveStatus(3, false), "community");
  assert.equal(deriveStatus(1, true), "official");
});

test("upsertEvent adds a distinct event", () => {
  const { events, action } = upsertEvent([], {
    ...base,
    id: "a",
    occurredAt: "2026-07-22T00:00:00Z",
    affectedPlans: ["Plus"],
  });
  assert.equal(action, "added");
  assert.equal(events.length, 1);
  assert.equal(events[0].daysEarly, 5);
});

test("three reports about the same reset merge into one community event", () => {
  let events = [];
  ({ events } = upsertEvent(events, {
    ...base,
    id: "a",
    occurredAt: "2026-07-22T02:00:00Z",
    affectedPlans: ["Plus"],
    sourceUrl: "u1",
  }));
  ({ events } = upsertEvent(events, {
    ...base,
    id: "b",
    occurredAt: "2026-07-22T08:00:00Z",
    affectedPlans: ["Pro"],
    sourceName: "s2",
    sourceUrl: "u2",
  }));
  ({ events } = upsertEvent(events, {
    ...base,
    id: "c",
    occurredAt: "2026-07-21T20:00:00Z",
    affectedPlans: ["Unknown"],
    sourceName: "s3",
    sourceUrl: "u3",
  }));

  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.status, "community");
  assert.equal(e.reportCount, 3);
  assert.deepEqual(e.affectedPlans, ["Plus", "Pro"]); // Unknown dropped once real plans exist
  assert.equal(e.occurredAt, "2026-07-21T20:00:00Z"); // earliest wins
  assert.equal(e.id, "a"); // stable id from the first event
  assert.equal(e.sources.length, 3);
});

test("a distinct later reset stays separate", () => {
  let events = [];
  ({ events } = upsertEvent(events, {
    ...base,
    id: "a",
    occurredAt: "2026-07-22T02:00:00Z",
    affectedPlans: ["Plus"],
  }));
  ({ events } = upsertEvent(events, {
    ...base,
    id: "d",
    occurredAt: "2026-08-15T00:00:00Z",
    scheduledAt: "2026-08-20T00:00:00Z",
    affectedPlans: ["Team"],
  }));
  assert.equal(events.length, 2);
});

test("an official source promotes status, title and headline source", () => {
  let events = [];
  ({ events } = upsertEvent(events, {
    ...base,
    id: "a",
    occurredAt: "2026-08-15T00:00:00Z",
    scheduledAt: "2026-08-20T00:00:00Z",
    affectedPlans: ["Plus"],
  }));
  ({ events } = upsertEvent(events, {
    ...base,
    id: "off",
    occurredAt: "2026-08-15T03:00:00Z",
    scheduledAt: "2026-08-20T00:00:00Z",
    status: "official",
    title: "OpenAI note",
    affectedPlans: ["Unknown"],
    sourceName: "OpenAI Status",
    sourceUrl: "uo",
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "official");
  assert.equal(events[0].title, "OpenAI note");
  assert.equal(events[0].sourceName, "OpenAI Status");
});

test("collector merge refreshes community count, description, and individual sources", () => {
  let events = [
    {
      ...base,
      id: "auto-first",
      occurredAt: "2026-08-15T00:00:00Z",
      scheduledAt: null,
      reportCount: 3,
      sourceName: "3 Reddit reports",
      sourceUrl: "u1",
      sources: [{ name: "Observed reset one", url: "u1" }],
      automated: true,
    },
  ];

  ({ events } = upsertEvent(events, {
    ...base,
    id: "auto-second",
    occurredAt: "2026-08-15T04:00:00Z",
    scheduledAt: null,
    reportCount: 3,
    sourceName: "3 Reddit reports",
    sourceUrl: "u2",
    sources: [
      { name: "Observed reset two", url: "u2" },
      { name: "Observed reset three", url: "u3" },
      { name: "Observed reset four", url: "u4" },
    ],
    automated: true,
  }));

  assert.equal(events[0].reportCount, 6);
  assert.equal(events[0].sourceName, "6 community reports");
  assert.equal(
    events[0].description,
    "6 independent community reports suggest a quota reset occurred around this time.",
  );
  assert.deepEqual(
    events[0].sources.map((source) => source.url),
    ["u1", "u2", "u3", "u4"],
  );
});
