// Reuse the exact reviewed indexer replay harnesses without editing their checkout.
// No RPC/provider call or production database is involved. Generated test files
// belong to the run's scratch directory and are evidence, not source overrides.
// One run per fee model: the fixed-base harness and fixture (evm-contracts
// 43d6628) and the tick-rate ones (3d6378f), each with its API cases.
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const root = process.env.ZERO_SEED_INDEXER_WORKTREE;
const scratch = process.env.LAUNCH_REPLAY_SCRATCH_DIR;
const pg = process.env.TEST_PG_CONNECTION_STRING;
if (!root || !scratch || !pg)
  throw new Error(
    "Indexer worktree, run scratch and local Postgres are required",
  );
const url = new URL(pg);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Only loopback test Postgres is permitted");
const head = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"]);
if (
  head.stdout.toString().trim() !== "7f373e59ca79eadb5d7ce47a29eb7f02decf31da"
)
  throw new Error("Indexer source pin mismatch");
const clean = Bun.spawnSync([
  "git",
  "-C",
  root,
  "diff",
  "--quiet",
  "HEAD",
  "--",
]);
if (clean.exitCode !== 0)
  throw new Error("Pinned indexer tracked source is modified");

const RUNS = [
  {
    harness: "src/evm/zeroSeedLaunchReplay.postgres.test.ts",
    fixture: "tests/fixtures/zero-seed-launch/local-chain.json",
    sha256: "ec308953b8412e3ad76e7b6bf74b1e3ae56f6cbe0798032dbc6673bfedfae7d9",
    cases: "launchReplayCases.txt",
    target: "api-emitted-replay.test.ts",
  },
  {
    harness: "src/evm/zeroSeedLaunchReplayV2.postgres.test.ts",
    fixture: "tests/fixtures/zero-seed-launch/local-chain-v2.json",
    sha256: "52377ccd26930d893aa656d7835375536c7e13375faa437d1b8d220f1b1d1d2f",
    cases: "launchReplayCasesV2.txt",
    target: "api-emitted-replay-tick-rate.test.ts",
  },
];

const api = resolve(import.meta.dir, "../src");
await mkdir(scratch, { recursive: true });
let failed = 0;
for (const run of RUNS) {
  const fixtureBytes = await Bun.file(resolve(root, run.fixture)).arrayBuffer();
  if (
    new Bun.CryptoHasher("sha256").update(fixtureBytes).digest("hex") !==
    run.sha256
  )
    throw new Error(`Emitted fixture pin mismatch: ${run.fixture}`);
  const original = resolve(root, run.harness);
  let source = await Bun.file(original).text();
  source = source.replace(/from "([^"]+)"/g, (match, name: string) => {
    if (name.startsWith("node:") || name === "bun:test") return match;
    const target = name.startsWith(".")
      ? resolve(dirname(original), name)
      : Bun.resolveSync(name, root);
    return `from ${JSON.stringify(target)}`;
  });
  source = source.replace(
    'const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");',
    `const ROOT = ${JSON.stringify(root)};`,
  );
  const extra = await Bun.file(resolve(import.meta.dir, run.cases)).text();
  source = `import { spyOn } from "bun:test";
import { LaunchQueries } from ${JSON.stringify(resolve(api, "routes/launches/queries"))};
import { LOCAL_INSTANCES, LOCAL_QUOTES, halfLifeSeconds } from ${JSON.stringify(resolve(api, "routes/launches/policy"))};
import { Queries } from ${JSON.stringify(resolve(api, "queries"))};
import { app } from ${JSON.stringify(resolve(api, "router"))};
${source}`;
  // The harness ends by closing its describe callback, as `});` or, formatted
  // across lines, `  },\n);`. The API cases go inside that callback.
  const ending = source.search(/\n(?:\}\);|  \},\n\);)\s*$/);
  if (ending < 0) throw new Error("Unrecognized pinned indexer harness");
  source = source.slice(0, ending + 1) + extra + source.slice(ending + 1);
  const target = resolve(scratch, run.target);
  await Bun.write(target, source);
  const child = Bun.spawn(["bun", "test", target, "--timeout", "300000"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  if ((await child.exited) !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
