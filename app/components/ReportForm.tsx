"use client";

import { useActionState, useRef } from "react";
import { submitReport, type ReportState } from "@/app/actions";

const PLANS = ["Free", "Plus", "Pro", "Team", "Enterprise"] as const;
const INITIAL: ReportState = { status: "idle" };

export default function ReportForm() {
  const [state, action, pending] = useActionState(submitReport, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  if (state.status === "success") {
    return (
      <div className="reportSuccess">
        <p className="reportSuccessIcon">✓</p>
        <p>
          <strong>Report submitted.</strong> It will appear on the tracker as{" "}
          <span className="badge suspected">Suspected</span> shortly.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="reportForm">
      {/* Honeypot — hidden from real users */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: "none" }}
      />

      <div className="formRow">
        <label htmlFor="occurredAt">
          When did the reset occur? <span className="required">*</span>
          <span className="fieldHint">UTC — format: YYYY-MM-DD HH:MM</span>
        </label>
        <input
          id="occurredAt"
          name="occurredAt"
          type="text"
          placeholder="2026-07-22 14:30"
          required
          pattern="\d{4}-\d{2}-\d{2} \d{2}:\d{2}"
        />
      </div>

      <div className="formRow">
        <label htmlFor="scheduledAt">
          What renewal date did Codex show? <span className="required">*</span>
          <span className="fieldHint">UTC — the date the app said your quota would renew.</span>
        </label>
        <input
          id="scheduledAt"
          name="scheduledAt"
          type="text"
          placeholder="2026-07-27 00:00"
          required
          pattern="\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?"
        />
      </div>

      <div className="formRow">
        <fieldset>
          <legend>
            Plans affected <span className="required">*</span>
          </legend>
          <div className="planGrid">
            {PLANS.map((plan) => (
              <label key={plan} className="planOption">
                <input type="checkbox" name="plans" value={plan} />
                {plan}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="formRow">
        <label htmlFor="description">
          What did you observe? <span className="required">*</span>
          <span className="fieldHint">
            Quota exhausted, then appeared renewed before expected date.
          </span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          required
          placeholder="My Codex quota was exhausted. The renewal date shown was 2026-07-27. I noticed it was full again on 2026-07-22."
        />
      </div>

      <div className="formRow">
        <label htmlFor="sourceUrl">
          Link to evidence
          <span className="fieldHint">Optional — Reddit thread, forum post, screenshot URL.</span>
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          placeholder="https://reddit.com/r/ChatGPT/..."
        />
      </div>

      {state.status === "error" && <p className="formError">{state.message}</p>}

      <button type="submit" className="submitBtn" disabled={pending}>
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}
