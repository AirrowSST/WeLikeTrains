import {
  scenarios,
  startDatamallSimulator,
  type SimulatorScenario,
} from "./datamall-simulator";
const arg = (name: string) => {
  const assigned = process.argv.find((value) => value.startsWith(`${name}=`));
  if (assigned) return assigned.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const scenario =
  arg("--scenario") ??
  (process.argv[2]?.startsWith("--") ? undefined : process.argv[2]) ??
  "normal";
if (!scenarios.includes(scenario as SimulatorScenario))
  throw new Error(`Choose: ${scenarios.join(", ")}`);
const clock = arg("--clock");
if (clock && !Number.isFinite(Date.parse(clock)))
  throw new Error("Invalid --clock timestamp");
const simulator = await startDatamallSimulator({
  port: Number(arg("--port") ?? 8090),
  scenario: scenario as SimulatorScenario,
  now: clock ? () => Date.parse(clock) : undefined,
});
console.log(
  `SIMULATED DataMall (${scenario}) at ${simulator.base}. Set LTA_BASE_URL in the app terminal; no real credential needed.`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void simulator.close().then(() => process.exit(0));
  });
