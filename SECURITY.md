# Security policy

## Supported version

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Open the
repository's **Security** tab, select **Advisories**, and choose **Report a
vulnerability**.

Do not open a public issue for a suspected vulnerability. Do not include real
Codex authentication, Neon connection strings, ingest tokens, webhook URLs,
account identifiers, raw `/wham/usage` payloads, or private database dumps in a
report. Use redacted examples and explain how the behavior can be reproduced
without production credentials.

The maintainer will acknowledge a report through the private advisory, assess
its impact, and coordinate a fix and disclosure there. Please allow time for a
fix before discussing the issue publicly.

## Project trust boundary

Codex credentials remain on the user's local machine. The hosted application
accepts only the versioned, allow-listed quota payload documented in the
README. See [docs/VISION.md](docs/VISION.md) for the architecture and
[docs/OPERATIONS.md](docs/OPERATIONS.md) for operational handling of secrets,
backups, and restores.
