"use server";

export type ReportState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

function buildIssueBody(fields: {
  occurredAt: string;
  plans: string[];
  sourceUrl: string;
  description: string;
}): string {
  return [
    `### When did the reset occur? (UTC)`,
    ``,
    fields.occurredAt,
    ``,
    `### Which plan(s) were affected?`,
    ``,
    fields.plans.join(", "),
    ``,
    `### Link to evidence (optional)`,
    ``,
    fields.sourceUrl || "_No link provided_",
    ``,
    `### Description`,
    ``,
    fields.description,
    ``,
    `### Confirmation`,
    ``,
    `- [x] I observed this reset myself or verified it from multiple independent sources.`,
  ].join("\n");
}

export async function submitReport(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  // Honeypot — bots fill this hidden field, humans don't
  if (formData.get("website")) {
    return { status: "success" };
  }

  const occurredAt = (formData.get("occurredAt") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim();
  const plans = formData.getAll("plans") as string[];
  const sourceUrl = (formData.get("sourceUrl") as string | null)?.trim() ?? "";

  if (!occurredAt || !description || plans.length === 0) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  // Basic date validation
  const parsed = new Date(occurredAt.replace(" ", "T") + ":00Z");
  if (isNaN(parsed.getTime())) {
    return { status: "error", message: "Invalid date format. Use YYYY-MM-DD HH:MM." };
  }

  const token = process.env.GITHUB_REPORT_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return {
      status: "error",
      message: "Report submission is not configured yet. Please open a GitHub Issue instead.",
    };
  }

  const body = buildIssueBody({ occurredAt, plans, sourceUrl, description });

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: `[Reset] Early quota reset reported via website`,
      body,
      labels: ["reset-report"],
    }),
  });

  if (!res.ok) {
    console.error("GitHub API error:", res.status, await res.text());
    return { status: "error", message: "Failed to submit report. Please try again later." };
  }

  return { status: "success" };
}
