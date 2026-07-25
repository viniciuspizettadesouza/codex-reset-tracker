import resetData from "@/data/resets.json";
import LiveQuotaPanel from "@/app/components/LiveQuotaPanel";
import ReportForm from "@/app/components/ReportForm";
import { getCachedLiveQuotaData } from "@/app/lib/live-quota-cache";

export const dynamic = "force-dynamic";

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

function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 3_600_000;
}

function countRecentEvents(events: ResetEvent[]): number {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return events.filter((e) => new Date(e.occurredAt) >= cutoff).length;
}

export default async function Home() {
  const liveQuotaData = await getCachedLiveQuotaData();
  const generatedAt = new Date().toISOString();
  const events = [...resetEvents].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const latest = events[0];
  const latestHoursAgo = hoursAgo(latest.occurredAt);
  const showBanner = latestHoursAgo <= 24;

  // Stats
  const daysEarlyValues = events
    .map((e) => e.daysEarly)
    .filter((d): d is number => typeof d === "number");
  const avgDaysEarly =
    daysEarlyValues.length > 0
      ? (daysEarlyValues.reduce((a, b) => a + b, 0) / daysEarlyValues.length).toFixed(1)
      : null;

  const planCounts: Record<string, number> = {};
  for (const event of events) {
    for (const plan of event.affectedPlans) {
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;
    }
  }
  const sortedPlans = Object.entries(planCounts).sort((a, b) => b[1] - a[1]);
  const mostAffectedPlan =
    sortedPlans.length === 0 || (sortedPlans.length > 1 && sortedPlans[0][1] === sortedPlans[1][1])
      ? "—"
      : sortedPlans[0][0];

  const recentCount = countRecentEvents(events);

  return (
    <main>
      <header className="siteHeader">
        <div className="shell siteHeaderInner">
          <a className="brand" href="#top" aria-label="Codex Reset Tracker home">
            <span className="brandMark" aria-hidden="true">
              &gt;_
            </span>
            <span>Codex Reset Tracker</span>
          </a>
          <nav className="headerNav">
            <a className="headerLink" href="#live-quota">
              Live quota
            </a>
            <a className="headerLink" href="#history">
              History
            </a>
            <a className="headerLink headerLinkAccent" href="#report">
              Report a reset
            </a>
          </nav>
        </div>
      </header>

      {showBanner && (
        <div className={`liveBanner ${latest.status}`} role="alert">
          <span className={`liveBannerDot ${latest.status}`} aria-hidden="true" />
          <span>
            <strong>
              {typeof latest.daysEarly === "number" && latest.daysEarly > 0
                ? "Early reset detected"
                : "Reset detected"}{" "}
              {Math.round(latestHoursAgo)}h ago
            </strong>
            {" — "}
            {latest.title}
          </span>
          <a className="liveBannerLink" href="#history">
            View details
          </a>
        </div>
      )}

      <section className="hero" id="top">
        <div className="shell heroInner">
          <div className="quotaSignal" aria-hidden="true">
            <span className="quotaSignalPrompt">&gt;_</span>
            <span className="quotaSignalLine" />
            <span className="quotaSignalLine short" />
          </div>
          <h1>Codex Reset Tracker</h1>
          <p className="heroCopy">
            OpenAI Codex sometimes resets usage limits early. This tracker shows you exactly when, so
            you stop refreshing and start coding.
          </p>
          <a className="heroAction" href="#live-quota">
            View live quota <span aria-hidden="true">↓</span>
          </a>
          <div className="heroTerminal" aria-hidden="true">
            <span>weekly_limit</span>
            <span>[##########]</span>
            <strong>reset</strong>
            <span>expected</span>
            <span>
              {latest.scheduledAt ? dateFormatter.format(new Date(latest.scheduledAt)) : "unknown"}
            </span>
            <span />
            <span>observed</span>
            <span>{dateFormatter.format(new Date(latest.occurredAt))}</span>
            <span>&gt;&gt;&gt;</span>
          </div>
        </div>
      </section>

      <LiveQuotaPanel data={liveQuotaData} generatedAt={generatedAt} />

      <section className="shell latestSection" id="latest">
        <div className="latestCard">
          <div>
            <p className="label">Most recent reset</p>
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
              <strong>
                {latest.reportCount} {latest.reportCount === 1 ? "report" : "reports"}
              </strong>
            </div>
            <div>
              <span className="metaLabel">Source</span>
              {latest.sourceUrl ? (
                <a href={latest.sourceUrl} target="_blank" rel="noreferrer">
                  {latest.sourceName} ↗
                </a>
              ) : (
                <strong>{latest.sourceName}</strong>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="shell statsSection" id="stats">
        <p className="label">At a glance</p>
        <div className="statsGrid">
          <div className="statTile">
            <span className="statLabel">Total resets</span>
            <span className="statValue">{events.length}</span>
          </div>
          <div className="statTile">
            <span className="statLabel">Avg days early</span>
            <span className="statValue">{avgDaysEarly ?? "—"}</span>
          </div>
          <div className="statTile">
            <span className="statLabel">Most affected plan</span>
            <span className="statValue">{mostAffectedPlan}</span>
          </div>
          <div className="statTile">
            <span className="statLabel">Last 30 days</span>
            <span className="statValue">{recentCount}</span>
          </div>
        </div>
      </section>

      <section className="shell historySection" id="history">
        <div className="sectionHeading">
          <div>
            <p className="label">Timeline</p>
            <h2>Reset history</h2>
          </div>
          <p>{events.length} events on record</p>
        </div>

        <div className="timeline">
          {events.map((event) => (
            <article className="eventCard" key={event.id}>
              <div className={`timelineDot ${event.status}`} aria-hidden="true" />
              <div className="eventTopline">
                <time dateTime={event.occurredAt}>
                  {dateFormatter.format(new Date(event.occurredAt))}
                </time>
                <span className={`badge ${event.status}`}>{statusLabels[event.status]}</span>
              </div>
              <h3>{event.title}</h3>
              <p>{event.description}</p>
              <div className="eventFooter">
                <span>Affects: {event.affectedPlans.join(", ")}</span>
                {typeof event.daysEarly === "number" && (
                  <span className="daysEarly">{formatDaysEarly(event.daysEarly)}</span>
                )}
                <span className="reportCount">
                  {event.reportCount} {event.reportCount === 1 ? "report" : "reports"}
                </span>
                {event.sourceUrl ? (
                  <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                    {event.sourceName} ↗
                  </a>
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
            <p className="label">Contribute</p>
            <h2>Report a reset</h2>
          </div>
          <p>
            Noticed your Codex quota renewed before the expected date? Add what you saw and it helps
            confirm the pattern. Takes under a minute.
          </p>
        </div>
        <ReportForm />
      </section>

      <section className="shell methodology">
        <div>
          <p className="label">Methodology</p>
          <h2>Evidence before certainty.</h2>
        </div>
        <div className="methodGrid">
          <div>
            <span className="legend official" /> <strong>Official</strong>
            <p>Confirmed by an OpenAI-controlled source.</p>
          </div>
          <div>
            <span className="legend community" /> <strong>Community confirmed</strong>
            <p>Multiple consistent reports from independent users, with no official announcement.</p>
          </div>
          <div>
            <span className="legend suspected" /> <strong>Suspected</strong>
            <p>Early evidence that still needs verification.</p>
          </div>
        </div>
      </section>

      <footer className="shell footer">
        <p>An independent project. Not affiliated with OpenAI.</p>
        <p>
          Feeds: <a href="/api/feed">JSON</a> · <a href="/api/feed/rss">RSS</a>
        </p>
        <p className="footerUpdated">Updated {dateFormatter.format(new Date(lastUpdatedAt))}</p>
      </footer>
    </main>
  );
}
