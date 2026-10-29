import { config } from "dotenv";
import path from "node:path";
config({ path: path.join(__dirname, ".env") });
import { defineConfig } from "prisma/config";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "js",
  experimental: { adapter: true },
  adapter: async () =>
    new PrismaLibSQL({
      url: process.env.DATABASE_URL || "file:./prisma/dev.db",
    }),
});
