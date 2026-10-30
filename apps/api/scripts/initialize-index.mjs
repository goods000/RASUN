export async function initializeIndex(db, schema, { timeout = 15000 } = {}) {
  const required = [
    ...schema.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+"([^"]+)"/gi,
    ),
  ].map((match) => match[1]);
  const until = Date.now() + timeout;
  let waiting = false;
  for (;;) {
    try {
      const objects = await db.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','index')",
      );
      const existing = new Set(objects.rows.map((row) => row.name));
      // Avoid obtaining a schema write lock when the persistent index is already initialized.
      if (!required.length || required.some((name) => !existing.has(name)))
        await db.executeMultiple(schema);
      return;
    } catch (error) {
      if (!["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error?.code)) throw error;
      if (Date.now() >= until)
        throw Error(
          "LOCAL_INDEX_BUSY: SQLite index remains locked. Stop the other RASUN dev:testnet/API instance with Ctrl+C and retry. Do not delete the database.",
        );
      if (!waiting) {
        console.log(
          "SQLite index is busy; waiting for the current writer (up to 15 seconds)...",
        );
        waiting = true;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, until - Date.now()))),
      );
    }
  }
}
