import resetData from "@/data/resets.json";
import ReportForm from "@/app/components/ReportForm";

type Plan = "Free" | "Plus" | "Pro" | "Team" | "Enterprise" | "Unknown";

type ResetStatus = "official" | "community" | "suspected";

type EventSource = { name: string; url?: string };

type ResetEvent = {
  id: string;
  occurredAt: string;
  scheduledAt?: string | null;
  daysEarly?: number | null;
  reportedAt: string;
  status: ResetStatus;
  title: string;
  affectedPlans: Plan[];
  reportCount: number;
  sourceName: string;
  sourceUrl?: string;
  sources?: EventSource[];
  description: string;
};

function formatDaysEarly(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"} early`;
}

type ResetData = {
  lastUpdatedAt: string;
  events: ResetEvent[];
};

const { lastUpdatedAt, events: resetEvents } = resetData as ResetData;

const statusLabels: Record<ResetStatus, string> = {
  official: "Official",
  community: "Community confirmed",
  suspected: "Suspected",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export default function Home() {
  const events = [...resetEvents].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const latest = events[0];

  return (
    <main>
      <header className="siteHeader shell">
        <a className="brand" href="#top" aria-label="Codex Reset Tracker home">
          <span className="brandMark">C</span>
          <span>Codex Reset Tracker</span>
        </a>
        <nav className="headerNav">
          <a className="headerLink" href="#history">History</a>
          <a className="headerLink headerLinkAccent" href="#report">Report a reset</a>
        </nav>
      </header>

      <section className="hero shell" id="top">
        <div className="eyebrow"><span className="pulse" /> Community quota monitor</div>
        <h1>Know when Codex quotas reset early.</h1>
        <p className="heroCopy">
          Community-driven tracker of Codex quota resets that happen before the expected renewal date. No official source covers this — so we do.
        </p>

        <div className="latestCard">
          <div>
            <p className="label">Latest known event</p>
            <h2>{latest.title}</h2>
            <p className="latestDescription">{latest.description}</p>
          </div>
          <div className="latestMeta">
            <div>
              <span className="metaLabel">Date</span>
              <strong>{dateFormatter.format(new Date(latest.occurredAt))}</strong>
            </div>
            {typeof latest.daysEarly === "number" && (
              <div>
                <span className="metaLabel">How early</span>
                <strong>{formatDaysEarly(latest.daysEarly)}</strong>
              </div>
            )}
            <div>
              <span className="metaLabel">Confidence</span>
              <span className={`badge ${latest.status}`}>{statusLabels[latest.status]}</span>
            </div>
            <div>
              <span className="metaLabel">Plans</span>
              <strong>{latest.affectedPlans.join(", ")}</strong>
            </div>
            <div>
              <span className="metaLabel">Reports</span>
              <strong>{latest.reportCount} {latest.reportCount === 1 ? "report" : "reports"}</strong>
            </div>
            <div>
              <span className="metaLabel">Source</span>
              {latest.sourceUrl ? (
                <a href={latest.sourceUrl} target="_blank" rel="noreferrer">{latest.sourceName} ↗</a>
              ) : (
                <strong>{latest.sourceName}</strong>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="shell historySection" id="history">
        <div className="sectionHeading">
          <div>
            <p className="label">Timeline</p>
            <h2>Reset history</h2>
          </div>
          <p>{events.length} tracked events</p>
        </div>

        <div className="timeline">
          {events.map((event) => (
            <article className="eventCard" key={event.id}>
              <div className={`timelineDot ${event.status}`} aria-hidden="true" />
              <div className="eventTopline">
                <time dateTime={event.occurredAt}>{dateFormatter.format(new Date(event.occurredAt))}</time>
                <span className={`badge ${event.status}`}>{statusLabels[event.status]}</span>
              </div>
              <h3>{event.title}</h3>
              <p>{event.description}</p>
              <div className="eventFooter">
                <span>Plans: {event.affectedPlans.join(", ")}</span>
                {typeof event.daysEarly === "number" && (
                  <span className="daysEarly">{formatDaysEarly(event.daysEarly)}</span>
                )}
                <span className="reportCount">{event.reportCount} {event.reportCount === 1 ? "report" : "reports"}</span>
                {event.sourceUrl ? (
                  <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceName} ↗</a>
                ) : (
                  <span>{event.sourceName}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="shell reportSection" id="report">
        <div className="sectionHeading">
          <div>
            <p className="label">Community</p>
            <h2>Report a reset</h2>
          </div>
          <p>Noticed your quota renewed before the expected date? Submit a report.</p>
        </div>
        <ReportForm />
      </section>

      <section className="shell methodology">
        <div>
          <p className="label">Methodology</p>
          <h2>Evidence before certainty.</h2>
        </div>
        <div className="methodGrid">
          <div><span className="legend official" /> <strong>Official</strong><p>Confirmed by an OpenAI-controlled source.</p></div>
          <div><span className="legend community" /> <strong>Community confirmed</strong><p>Several consistent reports, without an official announcement.</p></div>
          <div><span className="legend suspected" /> <strong>Suspected</strong><p>Early evidence that still needs verification.</p></div>
        </div>
      </section>

      <footer className="shell footer">
        <p>Independent community project. Not affiliated with OpenAI.</p>
        <p className="footerUpdated">Updated {dateFormatter.format(new Date(lastUpdatedAt))}</p>
      </footer>
    </main>
  );
}
