import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const backupScript = resolve("scripts/backup-db.sh");
const restoreScript = resolve("scripts/verify-db-restore.sh");

async function executable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o700);
}

test("backup writes a private archive without putting the URL in command arguments", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-backup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const bin = join(root, "bin");
  const backupDirectory = join(root, "backups");
  const argumentLog = join(root, "arguments.log");
  await mkdir(bin);
  await executable(
    join(bin, "pg_dump"),
    `#!/bin/sh
for argument do
  case "$argument" in
    --file=*) output="\${argument#--file=}" ;;
  esac
done
printf 'archive' > "$output"
printf '%s\\n' "$@" > "$ARGUMENT_LOG"
`,
  );
  await executable(join(bin, "pg_restore"), "#!/bin/sh\nexit 0\n");

  const databaseUrl = "postgresql://backup-user:secret@example.test/neondb";
  const result = spawnSync("bash", [backupScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ARGUMENT_LOG: argumentLog,
      BACKUP_DATABASE_URL: databaseUrl,
      CODEX_BACKUP_DIR: backupDirectory,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const backupName = result.stdout.match(/codex-reset-tracker-[0-9TZ]+\.dump/)?.[0];
  assert.ok(backupName);
  assert.equal((await stat(join(backupDirectory, backupName))).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(argumentLog, "utf8"), /secret|postgresql:/);
});

test("restore refuses a production database before invoking pg_restore", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-restore-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const bin = join(root, "bin");
  const backupPath = join(root, "backup.dump");
  const restoreMarker = join(root, "restore-invoked");
  await mkdir(bin);
  await writeFile(backupPath, "archive");
  await executable(join(bin, "psql"), "#!/bin/sh\nprintf 'neondb\\n'\n");
  await executable(join(bin, "pg_restore"), `#!/bin/sh\ntouch "$RESTORE_MARKER"\n`);

  const result = spawnSync("bash", [restoreScript, backupPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RESTORE_DATABASE_URL: "postgresql://owner:secret@production.example/neondb",
      RESTORE_MARKER: restoreMarker,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to restore into 'neondb'/);
  await assert.rejects(stat(restoreMarker), { code: "ENOENT" });
});
