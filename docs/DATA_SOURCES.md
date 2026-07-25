# Data sources for Codex quota resets

Reference material for finding and corroborating early Codex quota resets. The
authoritative signal is the personal monitor reading `/wham/usage` (see
[VISION.md](VISION.md)); the sources below are secondary / corroboration.

## First-party (authoritative)

| Source         | Where                                                                    | Notes                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Usage endpoint | `GET https://chatgpt.com/backend-api/wham/usage`                         | Backs the usage panel. Read by `scripts/monitor.mjs`. Auth: `Authorization: Bearer <access_token>` + `ChatGPT-Account-Id: <account_id>` from `~/.codex/auth.json`. |
| Usage panel    | https://chatgpt.com/codex/settings/usage                                 | Most complete human view: weekly usage, next reset, other limits.                                                                                                  |
| Limit banner   | In-app                                                                   | e.g. "Your rate limit resets on Jul 23, 2026, 1:13 PM."                                                                                                            |
| Reset credits  | `GET/POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` | The official savable-reset feature (rolled out 2026-06-12).                                                                                                        |

## Announcements & incidents (corroboration)

- **[Tibo / Thibault Sottiaux (`@thsottiaux`) on
  X](https://x.com/thsottiaux)** — Codex lead engineer. ⭐ Extraordinary global
  resets are usually announced here first ("I have reset Codex rate limits for
  ALL paid plans…"). No official reset changelog exists, so this is the closest
  thing to an announcement channel. For free alerts, follow the account and
  enable X's notification bell for all posts. `scripts/collect.mjs` can poll it
  through the paid X API v2 recent-search endpoint when
  `TWITTER_BEARER_TOKEN` is set; leave that source disabled for a zero-cost
  deployment. Confirmed example: [25 July 2026 outage-compensation
  reset](https://x.com/thsottiaux/status/2081096447718723984).
- **OpenAI Status** — https://status.openai.com — incident-linked resets appear
  here. Example incident (usage depleting faster than expected):
  https://status.openai.com/incidents/01KW2E6W0503W4NXJNCVAG8V6T
  Polled by `scripts/collect.mjs`.

## Community (early detection)

- **r/codex** — primary; early resets are often reported within minutes.
  Example: https://www.reddit.com/r/codex/comments/1rnpm9a/weekly_limits_just_got_reset_early_for_everyone/
- **r/ChatGPT**, **r/OpenAI** — secondary.
- All three are polled via RSS by `scripts/collect.mjs`. The r/codex query is
  intentionally broad because short titles such as "Reset incoming" are common;
  the general-subreddit queries remain Codex-qualified to limit noise. Note:
  Reddit increasingly rate-limits/blocks datacenter IPs, so this source can go
  quiet — do not rely on it alone.

## Feature gaps (why this project exists)

Requested but not implemented in Codex — confirming the gap this project fills:

- openai/codex #20395 — clarify reset behavior, make reset scope visible in Usage UI.
- openai/codex #20583 — Usage UI should show special reset events and affected intervals.
- openai/codex #15281 — expose full usage/limits data in the CLI `/status`.

## Known causes of early resets

- Global reset by OpenAI to compensate for a usage/accounting problem.
- Bug fixes in the credit-accounting system.
- Temporary limit-policy changes during infra testing.

The scheduled date in the usage panel is the best reference but **not a guarantee** —
OpenAI can pull it forward without notice.
