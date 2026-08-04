"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import type { LocalMonitorStatus, LocalPollHistory } from "@/app/lib/local-monitor-status";

const refreshIntervalMs = 30_000;

function localDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function duration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(1)}s`;
}

function age(value: number | null): string {
  if (value === null) return "No successful poll";
  if (value < 60) return `${Math.floor(value)}s ago`;
  if (value < 3_600) return `${Math.floor(value / 60)}m ago`;
  return `${Math.floor(value / 3_600)}h ago`;
}

function statusLabel(status: LocalMonitorStatus["health"]["status"]): string {
  return status === "healthy" ? "Healthy" : status === "degraded" ? "Degraded" : "Offline";
}

function syncLabel(status: LocalMonitorStatus["publishing"]["remote"]["status"]): string {
  const labels = {
    disabled: "Comparison disabled",
    synced: "Hosted snapshot synced",
    lagging: "Hosted snapshot behind",
    ahead: "Hosted snapshot ahead",
    unavailable: "Hosted snapshot unavailable",
  };
  return labels[status];
}

function QuotaHistory({
  history,
  generatedAt,
}: {
  history: LocalPollHistory[];
  generatedAt: string;
}) {
  const points = history.filter(
    (entry): entry is LocalPollHistory & { usedPercent: number } => entry.usedPercent !== null,
  );
  if (points.length === 0) {
    return <div className="localChartEmpty">No local quota history yet.</div>;
  }

  const width = 760;
  const height = 220;
  const left = 42;
  const right = 744;
  const top = 18;
  const bottom = 182;
  const end = Date.parse(generatedAt);
  const start = end - 7 * 24 * 60 * 60 * 1_000;
  const coordinates = points.map((entry) => {
    const progress = Math.min(
      1,
      Math.max(0, (Date.parse(entry.completedAt) - start) / (end - start)),
    );
    const remaining = 100 - entry.usedPercent;
    return [left + progress * (right - left), top + ((100 - remaining) / 100) * (bottom - top)];
  });
  const path = coordinates.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

  return (
    <svg
      className="localChart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Seven-day local remaining quota history"
    >
      {[0, 50, 100].map((remaining) => {
        const y = top + ((100 - remaining) / 100) * (bottom - top);
        return (
          <g key={remaining}>
            <line x1={left} x2={right} y1={y} y2={y} />
            <text x="4" y={y + 4}>
              {remaining}%
            </text>
          </g>
        );
      })}
      <path d={path} />
      {points.map((entry, index) => {
        if (!entry.resetDetected) return null;
        const [x, y] = coordinates[index];
        return <circle className="localChartReset" cx={x} cy={y} r="5" key={entry.completedAt} />;
      })}
      <text x={left} y="212">
        7d ago
      </text>
      <text x={right} y="212" textAnchor="end">
        now
      </text>
    </svg>
  );
}

export default function LocalDashboard() {
  const [data, setData] = useState<LocalMonitorStatus | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/local/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`Status request failed with HTTP ${response.status}`);
      setData((await response.json()) as LocalMonitorStatus);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Status request failed");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const recentPolls = useMemo(() => data?.history.slice(-48) ?? [], [data]);

  if (!data) {
    return (
      <main className="localDashboard localLoading">
        <div>
          <span className="brandMark" aria-hidden="true">
            &gt;_
          </span>
          <h1>Local monitor</h1>
          <p>{requestError ?? "Reading the monitor state…"}</p>
          {requestError && <button onClick={() => void refresh()}>Retry</button>}
        </div>
      </main>
    );
  }

  const ringStyle = {
    "--quota-angle": `${(data.quota?.remainingPercent ?? 0) * 3.6}deg`,
  } as CSSProperties;

  return (
    <main className="localDashboard">
      <header className="localHeader">
        <div>
          <span className="brandMark" aria-hidden="true">
            &gt;_
          </span>
          <div>
            <p>Codex Reset Tracker</p>
            <h1>Local monitor</h1>
          </div>
        </div>
        <div className="localRefresh">
          <span>Auto-refreshes every 30s</span>
          <button onClick={() => void refresh()}>Refresh now</button>
        </div>
      </header>

      {requestError && (
        <p className="localRequestError">Showing the last response. {requestError}</p>
      )}

      <section className={`localHealthBanner ${data.health.status}`}>
        <div>
          <span className="localHealthDot" aria-hidden="true" />
          <div>
            <p>Monitor health</p>
            <h2>{statusLabel(data.health.status)}</h2>
          </div>
        </div>
        <p>
          Last successful poll <strong>{age(data.health.ageSeconds)}</strong>
          <span>·</span>
          {data.health.consecutiveFailures} consecutive failure
          {data.health.consecutiveFailures === 1 ? "" : "s"}
          <span>·</span>
          {data.publishing.pendingCount} queued upload
          {data.publishing.pendingCount === 1 ? "" : "s"}
        </p>
      </section>

      <section className="localOverview">
        <article className="localCard localQuotaCard">
          <div className="localCardHeading">
            <div>
              <p>Weekly quota</p>
              <h2>Local signal</h2>
            </div>
            <span>{data.quota ? "Latest poll" : "Waiting"}</span>
          </div>
          {data.quota ? (
            <div className="localQuotaBody">
              <div className="quotaRing" style={ringStyle}>
                <div>
                  <strong>{data.quota.remainingPercent}%</strong>
                  <span>remaining</span>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Used</dt>
                  <dd>{data.quota.usedPercent}%</dd>
                </div>
                <div>
                  <dt>Reset scheduled</dt>
                  <dd>{localDate(data.quota.resetAt)}</dd>
                </div>
                <div>
                  <dt>Observed</dt>
                  <dd>{localDate(data.quota.observedAt)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="localEmptyCopy">No valid weekly snapshot is available.</p>
          )}
        </article>

        <article className="localCard">
          <div className="localCardHeading">
            <div>
              <p>Poll reliability</p>
              <h2>Last 7 days</h2>
            </div>
          </div>
          <div className="localMetrics">
            <div>
              <span>Success rate</span>
              <strong>
                {data.health.successRate === null ? "—" : `${data.health.successRate}%`}
              </strong>
            </div>
            <div>
              <span>Last duration</span>
              <strong>{duration(data.health.lastDurationMs)}</strong>
            </div>
            <div>
              <span>Poll interval</span>
              <strong>{Math.round(data.health.intervalSeconds / 60)}m</strong>
            </div>
            <div>
              <span>Samples</span>
              <strong>{data.history.length}</strong>
            </div>
          </div>
          <div className="localPollStrip" aria-label="Recent poll results">
            {recentPolls.length === 0 ? (
              <span className="localEmptyCopy">No polls recorded.</span>
            ) : (
              recentPolls.map((poll) => (
                <i
                  className={poll.result}
                  title={`${poll.result} — ${localDate(poll.completedAt)}`}
                  key={`${poll.completedAt}-${poll.startedAt}`}
                />
              ))
            )}
          </div>
          <p className="localLegend">
            <span className="success" /> Success <span className="partial" /> Partial{" "}
            <span className="failure" /> Failure
          </p>
        </article>

        <article className="localCard localPublishCard">
          <div className="localCardHeading">
            <div>
              <p>Publishing</p>
              <h2>Hosted sync</h2>
            </div>
            <span className={data.publishing.remote.status}>
              {syncLabel(data.publishing.remote.status)}
            </span>
          </div>
          <dl className="localPublishFacts">
            <div>
              <dt>Publisher</dt>
              <dd>{data.publishing.configured ? "Configured" : "Disabled"}</dd>
            </div>
            <div>
              <dt>Queue</dt>
              <dd>{data.publishing.pendingCount}</dd>
            </div>
            <div>
              <dt>Last result</dt>
              <dd>{data.publishing.lastStatus}</dd>
            </div>
            <div>
              <dt>Last published</dt>
              <dd>{localDate(data.publishing.lastPublishedObservedAt)}</dd>
            </div>
            <div>
              <dt>Remote observed</dt>
              <dd>{localDate(data.publishing.remote.observedAt)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="localCard localHistoryCard">
        <div className="localCardHeading">
          <div>
            <p>Local history</p>
            <h2>Remaining quota</h2>
          </div>
          <span>7 days</span>
        </div>
        <QuotaHistory history={data.history} generatedAt={data.generatedAt} />
      </section>

      <section className="localCard localErrorsCard">
        <div className="localCardHeading">
          <div>
            <p>Diagnostics</p>
            <h2>Recent errors</h2>
          </div>
          <span>{data.recentErrors.length} recorded</span>
        </div>
        {data.recentErrors.length === 0 ? (
          <p className="localEmptyCopy">No errors in the retained history.</p>
        ) : (
          <div className="localErrorTable">
            {data.recentErrors.map((error) => (
              <div key={`${error.at}-${error.message}`}>
                <time dateTime={error.at}>{localDate(error.at)}</time>
                <span className={error.result}>{error.result}</span>
                <p>{error.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="localFooter">
        <span>Read-only local diagnostics</span>
        <span>Generated {localDate(data.generatedAt)}</span>
      </footer>
    </main>
  );
}
