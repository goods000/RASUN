import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { createClient } = require("@libsql/client");
import { initializeIndex } from "../../apps/api/scripts/initialize-index.mjs";
test("persistent lock has a bounded local-database diagnostic", async () => {
  await assert.rejects(
    initializeIndex(
      {
        execute: async () => {
          throw Object.assign(Error("locked"), { code: "SQLITE_BUSY" });
        },
      },
      'CREATE TABLE IF NOT EXISTS "Example" (id INTEGER);',
      { timeout: 20 },
    ),
    /LOCAL_INDEX_BUSY/,
  );
});
test("an initialized database needs no schema write lock", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasun-db-ready-"));
  const url = "file:" + path.join(dir, "index.db");
  const db = createClient({ url });
  let tx;
  try {
    const schema = fs.readFileSync(
      new URL(
        "../../apps/api/prisma/migrations/001-index.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.executeMultiple(schema);
    tx = await db.transaction("write");
    const child = spawn(process.execPath, ["apps/api/scripts/db-setup.mjs"], {
      cwd: new URL("../../", import.meta.url),
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.equal(code, 0, output);
    assert.match(output, /SQLite index schema ready/);
  } finally {
    try {
      await tx?.rollback();
    } catch {}
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("database setup survives a short writer lock and preserves existing data", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasun-db-lock-"));
  const url = "file:" + path.join(dir, "index.db");
  const db = createClient({ url });
  let release, tx;
  try {
    await db.executeMultiple(
      "CREATE TABLE KeepMe(value TEXT); INSERT INTO KeepMe VALUES ('preserved');",
    );
    tx = await db.transaction("write");
    await tx.execute("INSERT INTO KeepMe VALUES ('also-preserved')");
    const child = spawn(process.execPath, ["apps/api/scripts/db-setup.mjs"], {
      cwd: new URL("../../", import.meta.url),
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    release = setTimeout(() => {
      void tx.commit();
    }, 1200);
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.equal(code, 0, output);
    assert.match(output, /SQLite index schema ready/);
    assert.equal(
      (await db.execute("SELECT COUNT(*) AS n FROM KeepMe")).rows[0].n,
      2,
    );
  } finally {
    clearTimeout(release);
    try {
      await tx?.rollback();
    } catch {}
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
