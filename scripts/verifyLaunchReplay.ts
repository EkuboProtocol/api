// Reuse the exact reviewed indexer replay harness without editing its checkout.
// No RPC/provider call or production database is involved. Generated test files
// belong to the run's scratch directory and are evidence, not source overrides.
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
  head.stdout.toString().trim() !== "c78a48e3aff1df7a8e3298545eee8be04474063d"
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
const fixturePath = resolve(
  root,
  "tests/fixtures/zero-seed-launch/local-chain.json",
);
const fixtureBytes = await Bun.file(fixturePath).arrayBuffer();
if (
  new Bun.CryptoHasher("sha256").update(fixtureBytes).digest("hex") !==
  "09d7745740af507a02304e26c0e20d6f27b1047fd707c056ef4d936c67a74fcc"
)
  throw new Error("Emitted fixture pin mismatch");
const original = resolve(root, "src/evm/zeroSeedLaunchReplay.postgres.test.ts");
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
const api = resolve(import.meta.dir, "../src");
const extra = await Bun.file(
  resolve(import.meta.dir, "launchReplayCases.txt"),
).text();
source = `import { spyOn } from "bun:test";
import { LaunchQueries } from ${JSON.stringify(resolve(api, "routes/launches/queries"))};
import { LOCAL_INSTANCES, LOCAL_QUOTES } from ${JSON.stringify(resolve(api, "routes/launches/policy"))};
import { Queries } from ${JSON.stringify(resolve(api, "queries"))};
import { app } from ${JSON.stringify(resolve(api, "router"))};
${source}`;
// The harness ends by closing its describe callback, as `});` or, formatted
// across lines, `  },\n);`. The API cases go inside that callback.
const ending = source.search(/\n(?:\}\);|  \},\n\);)\s*$/);
if (ending < 0) throw new Error("Unrecognized pinned indexer harness");
source = source.slice(0, ending + 1) + extra + source.slice(ending + 1);
await mkdir(scratch, { recursive: true });
const target = resolve(scratch, "api-emitted-replay.test.ts");
await Bun.write(target, source);
const run = Bun.spawn(["bun", "test", target, "--timeout", "300000"], {
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});
process.exit(await run.exited);
