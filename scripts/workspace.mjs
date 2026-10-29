import { run } from "./process.mjs";
try {
  await run(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
