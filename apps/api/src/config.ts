import fs from "node:fs";
import path from "node:path";
import { BadRequestException } from "@nestjs/common";
import { getAddress, isAddress } from "ethers";
export function rootDir() {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw Error("Run within RASUN workspace");
}
export function deployment() {
  const file = path.resolve(
    rootDir(),
    process.env.DEPLOYMENT_FILE || "deployments/local.json",
  );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function address(value: string) {
  if (!isAddress(value))
    throw new BadRequestException("Invalid wallet address");
  return getAddress(value);
}
export function paging(page = "1", limit = "20") {
  if (
    typeof page !== "string" ||
    typeof limit !== "string" ||
    !/^\d+$/.test(page) ||
    !/^\d+$/.test(limit)
  )
    throw new BadRequestException("Invalid pagination");
  const p = Number(page),
    l = Number(limit);
  if (
    !Number.isSafeInteger(p) ||
    p < 1 ||
    p > 1000000 ||
    !Number.isSafeInteger(l) ||
    l < 1 ||
    l > 100
  )
    throw new BadRequestException("page: 1..1000000, limit: 1..100");
  return { page: p, limit: l, skip: (p - 1) * l };
}
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}

export function databaseUrl() {
  const value = process.env.DATABASE_URL || "file:./prisma/dev.db";
  if (value.startsWith("file:")) {
    const target = value.slice(5);
    return (
      "file:" +
      (path.isAbsolute(target)
        ? target
        : path.resolve(rootDir(), "apps/api", target))
    );
  }
  throw Error("Only local SQLite is supported by this indexer");
}
