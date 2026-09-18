import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const playwrightCli = resolve(
  repoRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") {
      probe.close(() => reject(new Error("Could not allocate an E2E port.")));
      return;
    }
    probe.close((error) => (error ? reject(error) : resolvePort(address.port)));
  });
});

console.log(`Playwright server port: ${port}`);
const runId = `${Date.now()}-${process.pid}`;
const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      WAYCE_E2E_PORT: String(port),
      WAYCE_E2E_RUN_ID: runId,
    },
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
