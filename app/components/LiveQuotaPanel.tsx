"use client";

import { useMemo, useState, type CSSProperties } from "react";

import {
  buildLiveQuotaView,
  type ChartPoint,
  type HistoryRange,
  type LiveQuotaData,
} from "@/app/lib/live-quota";
import type { OfficialResetConfirmation } from "@/app/lib/reset-corroboration";

type LiveQuotaPanelProps = {
  data: LiveQuotaData;
  generatedAt: string;
  officialConfirmation: OfficialResetConfirmation | null;
};

const chartWidth = 700;
const chartHeight = 190;
const plotLeft = 42;
const plotRight = 684;
const plotTop = 16;
const plotBottom = 156;

function localDate(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function ageLabel(ageMinutes: number): string {
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${Math.floor(ageMinutes)}m ago`;
  if (ageMinutes < 24 * 60) return `${Math.floor(ageMinutes / 60)}h ago`;
  return `${Math.floor(ageMinutes / (24 * 60))}d ago`;
}

function chartCoordinates(
  point: ChartPoint,
  rangeDays: HistoryRange,
  generatedAt: number,
): [number, number] {
  const rangeMs = rangeDays * 24 * 60 * 60 * 1000;
  const start = generatedAt - rangeMs;
  const progress = Math.min(1, Math.max(0, (Date.parse(point.observedAt) - start) / rangeMs));
  const x = plotLeft + progress * (plotRight - plotLeft);
  const y = plotTop + ((100 - point.remainingPercent) / 100) * (plotBottom - plotTop);
  return [x, y];
}

function HistoryChart({
  points,
  rangeDays,
  generatedAt,
}: {
  points: ChartPoint[];
  rangeDays: HistoryRange;
  generatedAt: number;
}) {
  const coordinates = points.map((point) => chartCoordinates(point, rangeDays, generatedAt));
  const path = coordinates.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

  if (points.length === 0) {
    return <div className="quotaChartEmpty">No snapshots in this range yet.</div>;
  }

  return (
    <svg
      className="quotaChart"
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      role="img"
      aria-label={`${rangeDays}-day remaining quota history`}
    >
      {[0, 50, 100].map((remaining) => {
        const y = plotTop + ((100 - remaining) / 100) * (plotBottom - plotTop);
        return (
          <g key={remaining}>
            <line className="quotaChartGrid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
            <text className="quotaChartLabel" x="4" y={y + 4}>
              {remaining}%
            </text>
          </g>
        );
      })}
      <path className="quotaChartLine" d={path} />
      <circle
        className="quotaChartPoint"
        cx={coordinates.at(-1)?.[0]}
        cy={coordinates.at(-1)?.[1]}
        r="3"
      />
      {points.map((point, index) => {
        if (!point.resetDetected) return null;
        const [x, y] = coordinates[index];
        return (
          <circle className="quotaChartReset" cx={x} cy={y} r="5" key={point.observedAt}>
            <title suppressHydrationWarning>Reset detected at {localDate(point.observedAt)}</title>
          </circle>
        );
      })}
      <text className="quotaChartLabel" x={plotLeft} y="181">
        {rangeDays}d ago
      </text>
      <text className="quotaChartLabel" x={plotRight} y="181" textAnchor="end">
        now
      </text>
    </svg>
  );
}

export default function LiveQuotaPanel({
  data,
  generatedAt,
  officialConfirmation,
}: LiveQuotaPanelProps) {
  const [rangeDays, setRangeDays] = useState<HistoryRange>(30);
  const generatedTimestamp = Date.parse(generatedAt);
  const view = useMemo(
    () => buildLiveQuotaView(data.snapshots, data.resetEvents, generatedTimestamp),
    [data, generatedTimestamp],
  );

  if (!view.latest) {
    const copy =
      data.status === "unavailable"
        ? "Live quota data is temporarily unavailable. The community timeline remains online."
        : data.status === "unconfigured"
          ? "Connect the Neon database to start showing sanitized live quota data."
          : "The dashboard is ready and waiting for its first monitor snapshot.";
    return (
      <section className="shell liveQuotaSection" id="live-quota">
        <div className="liveQuotaEmpty">
          <div>
            <p className="label">Personal live signal</p>
            <h2>Waiting for quota data</h2>
          </div>
          <p>{copy}</p>
          <span className="liveStateBadge empty">No snapshot yet</span>
        </div>
      </section>
    );
  }

  const ringStyle = {
    "--quota-angle": `${(view.remainingPercent ?? 0) * 3.6}deg`,
  } as CSSProperties;
  const latestReset = view.latestReset;

  return (
    <section className="shell liveQuotaSection" id="live-quota">
      <div className={`liveQuotaCard ${view.state}`}>
        <div className="liveQuotaSummary">
          <div className="liveQuotaHeading">
            <div>
              <p className="label">Personal live signal</p>
              <h2>Weekly quota</h2>
            </div>
            <span className={`liveStateBadge ${view.state}`}>
              <span aria-hidden="true" />
              {view.state === "stale" ? "Monitor offline" : "Live"}
            </span>
          </div>

          <div className="liveQuotaPrimary">
            <div className="quotaRing" style={ringStyle}>
              <div>
                <strong>{view.remainingPercent}%</strong>
                <span>remaining</span>
              </div>
            </div>
            <div className="liveQuotaFacts">
              <div>
                <span>Used</span>
                <strong>{view.latest.usedPercent}%</strong>
              </div>
              <div>
                <span>Scheduled reset</span>
                <strong suppressHydrationWarning>{localDate(view.latest.resetAt)}</strong>
              </div>
              <div>
                <span>Last seen</span>
                <strong suppressHydrationWarning>{localDate(view.latest.observedAt)}</strong>
                <small>{ageLabel(view.ageMinutes ?? 0)}</small>
              </div>
            </div>
          </div>

          {view.state === "stale" && (
            <p className="liveQuotaNotice">
              No snapshot has arrived for more than 30 minutes. Values may be outdated; local
              monitoring will catch up when it reconnects.
            </p>
          )}
          {latestReset && (
            <div className={`liveQuotaResetEvidence ${officialConfirmation ? "confirmed" : ""}`}>
              <div className="liveQuotaResetEvidenceHeader">
                <p className="liveQuotaResetNote" suppressHydrationWarning>
                  <span aria-hidden="true">↻</span>
                  <span>
                    <strong>Detected independently</strong>
                    Last refill {localDate(latestReset.detectedAt)}
                    {latestReset.hoursEarly !== null ? ` — ${latestReset.hoursEarly}h early` : ""}
                  </span>
                </p>
                {officialConfirmation && (
                  <span className="badge official">Officially confirmed</span>
                )}
              </div>
              {officialConfirmation && (
                <p className="liveQuotaOfficialSource">
                  <span>{officialConfirmation.sourceName} corroborated this reset.</span>
                  <a
                    href={officialConfirmation.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View official confirmation: ${officialConfirmation.title}`}
                  >
                    View official X post ↗
                  </a>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="liveQuotaHistory">
          <div className="historyControls">
            <div>
              <span className="metaLabel">Remaining quota</span>
              <strong>Usage history</strong>
            </div>
            <div className="rangePicker" aria-label="History range">
              {([7, 30, 90] as const).map((days) => (
                <button
                  type="button"
                  aria-pressed={rangeDays === days}
                  onClick={() => setRangeDays(days)}
                  key={days}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
          <HistoryChart
            points={view.histories[rangeDays]}
            rangeDays={rangeDays}
            generatedAt={generatedTimestamp}
          />
          <p className="chartLegend">
            <span className="chartLegendLine" aria-hidden="true" /> Remaining quota
            <span className="chartLegendReset" aria-hidden="true" /> Detected refill
          </p>
        </div>
      </div>
    </section>
  );
}
