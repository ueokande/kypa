import { run } from "./index.js";

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once("SIGINT", interrupt);
try {
  process.exitCode = await run(
    process.argv.slice(2),
    process.env,
    undefined,
    controller.signal,
  );
} finally {
  process.removeListener("SIGINT", interrupt);
}
