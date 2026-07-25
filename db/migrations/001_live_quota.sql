-- Sanitized quota data only. Codex credentials and account identifiers must
-- never be added to these tables.
CREATE TABLE quota_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL UNIQUE,
  used_percent DOUBLE PRECISION NOT NULL
    CHECK (used_percent >= 0 AND used_percent <= 100),
  reset_at TIMESTAMPTZ NOT NULL,
  window_seconds INTEGER NOT NULL
    CHECK (window_seconds BETWEEN 518400 AND 691200),
  reset_detected BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reset_at > observed_at)
);

CREATE TABLE reset_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id BIGINT UNIQUE
    REFERENCES quota_snapshots(id) ON DELETE SET NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  expected_reset_at TIMESTAMPTZ,
  new_reset_at TIMESTAMPTZ NOT NULL,
  hours_early DOUBLE PRECISION CHECK (hours_early >= 0),
  previous_used_percent DOUBLE PRECISION NOT NULL
    CHECK (previous_used_percent >= 0 AND previous_used_percent <= 100),
  current_used_percent DOUBLE PRECISION NOT NULL
    CHECK (current_used_percent >= 0 AND current_used_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (expected_reset_at IS NULL AND hours_early IS NULL)
    OR (expected_reset_at IS NOT NULL AND hours_early IS NOT NULL)
  ),
  CHECK (previous_used_percent > current_used_percent)
);

CREATE INDEX quota_snapshots_observed_at_desc_idx
  ON quota_snapshots (observed_at DESC);

CREATE INDEX reset_events_detected_at_desc_idx
  ON reset_events (detected_at DESC);
