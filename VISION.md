# Codex Reset Tracker — Project Vision

## The problem

Codex has a weekly usage quota. When exhausted, the system shows a scheduled renewal date — for example, "your quota renews on July 27." The expected behavior is straightforward: the user waits until that date.

The problem is that this renewal **sometimes happens before the stated deadline**, with no warning or announcement. The user finds out by accident — they open the app a few days later and the quota is full again, even though the official date has not arrived yet.

This creates genuine uncertainty:

- Is an early renewal a pattern or was it a one-off?
- Did it happen to other users or just to me?
- How early does it typically happen?
- Is it worth waiting for a possible early renewal, or should I plan around the official date?

**No official or community source answers these questions.** OpenAI does not document this behavior, does not announce early renewals, and provides no mechanism to track them.

## The real goal

Build a community-driven, autonomous tracker that records a history of early Codex quota renewals, allowing any user to know:

1. Whether early renewals have happened before
2. How frequently they occur
3. Which plans were affected
4. The confidence level of each record (isolated observation, confirmed by multiple users, or from an official source)

## What "autonomous" means here

The tracker must not depend on any single person to keep the data current. This means:

- Any user who observes an early renewal can report it directly from the website, with no GitHub account or knowledge of the repository required
- An automated collector monitors public sources (Reddit, OpenAI Status) every 4 hours for mentions of early renewals
- Community reports are processed automatically and appear on the tracker without manual intervention

Human curation exists only to upgrade the confidence level of an event — from Suspected to Community confirmed — as more independent reports arrive.

## What this project is not

- Not a real-time Codex status monitor
- Not an availability or latency tracker
- It does not record on-schedule renewals — only those that happen **before** the indicated date
- Not affiliated with OpenAI and has no access to internal data

## Why this has value

The value grows with usage. A tracker with 10 events recorded over 6 months is already enough to identify whether early renewals are rare or common, whether they affect specific plans, and whether there is any time pattern. With enough data, a user with an exhausted quota can make an informed decision instead of simply waiting in the dark.
