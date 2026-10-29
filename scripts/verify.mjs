import { run } from "./process.mjs";
for (const args of [
  ["contract:test"],
  ["test:wallet"],
  ["--filter", "@rasun/api", "build"],
  ["--filter", "@rasun/admin", "build"],
  ["--filter", "@rasun/dapp", "build:h5"],
])
  await run(args);
