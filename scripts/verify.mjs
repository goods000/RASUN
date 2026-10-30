import { run } from "./process.mjs";
for (const args of [
  ["test:startup"],
  ["contract:test"],
  ["test:wallet"],
  ["--filter", "@rasun/api", "build"],
  ["test:testnet-api"],
  ["--filter", "@rasun/admin", "build"],
  ["--filter", "@rasun/dapp", "build:h5"],
])
  await run(args);
