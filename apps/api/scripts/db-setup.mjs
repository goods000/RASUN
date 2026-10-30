import { createClient } from "@libsql/client";
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeIndex } from "./initialize-index.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });
const value = process.env.DATABASE_URL || "file:./prisma/dev.db";
if (!value.startsWith("file:")) throw Error("Only local SQLite is supported");
const target = value.slice(5);
const file = path.isAbsolute(target) ? target : path.resolve(root, target);
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = createClient({ url: "file:" + file });
try {
  await initializeIndex(
    db,
    fs.readFileSync(path.join(root, "prisma/migrations/001-index.sql"), "utf8"),
  );
  console.log("SQLite index schema ready");
} finally {
  db.close();
}
