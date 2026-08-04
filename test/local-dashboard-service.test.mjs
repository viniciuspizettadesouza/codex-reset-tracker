import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const servicePath = new URL(
  "../ops/systemd/codex-reset-tracker-dashboard.service.template",
  import.meta.url,
);

test("local dashboard service is loopback-only and receives no monitor secrets", async () => {
  const service = await readFile(servicePath, "utf8");

  assert.match(service, /--hostname 127\.0\.0\.1 --port 3001/);
  assert.match(service, /Environment=LOCAL_DASHBOARD_ENABLED=1/);
  assert.match(service, /dashboard\.env/);
  assert.doesNotMatch(service, /monitor\.env|CODEX_INGEST_TOKEN|MONITOR_INGEST_TOKEN/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ProtectHome=read-only/);
});
