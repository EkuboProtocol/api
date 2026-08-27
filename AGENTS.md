# Repository Guidelines

## Project Structure & Module Organization
The TypeScript worker entrypoint lives in `src/index.ts`, wiring requests through `src/router.ts` into route modules. API domains live under `src/routes/*` (for example `prices`, `quote`, `stats`, `twamm`), each exporting handlers consumed by the router. Shared validation, formatting, and context utilities are in `src/shared`, while `src/env.ts` handles environment bindings and `src/queries.ts` wraps database access. Config lives in `wrangler.toml`, `tsconfig.json`, and `package.json`; coordinate before adding new top-level folders.

## Build, Test, and Development Commands
- `bun install` installs worker dependencies and shared SDKs.
- `bun run start` runs `wrangler dev`, expecting a PostgreSQL instance that matches the Ekubo indexer schema; set secrets with `wrangler secret put`.
- `bunx tsc --noEmit` performs a type-only compilation to catch regressions (bun test typings are now wired up via `bun-types`).
Hit `http://127.0.0.1:8787/...` with curl when debugging and watch the console logs for worker output.

## Coding Style & Naming Conventions
Write TypeScript using ES modules, prefer named exports, and keep domain-specific logic inside the matching `src/routes` folder. Follow Prettier defaults (2-space indentation, single quotes, trailing commas) and run `bunx prettier .` before committing formatting-heavy updates. File names stick to lower camel case for utilities (`parseOutTokens.ts`) and kebab-case directories (`src/routes/quote`). Use existing zod schemas as the source of truth for request and response validation rather than duplicating shape definitions.

## Testing Guidelines
There is no automated test harness yet, so combine `bunx tsc --noEmit` with targeted manual verification via `wrangler dev`. Document the requests you exercised in the PR description. For complex calculations or parsing helpers, add lightweight tests under `src/shared/__tests__` using Vitest (or similar) and share the invocation command so reviewers can repeat it.

## Commit & Pull Request Guidelines
Recent commits favour short, lowercase summaries (for example `improve the tokens endpoint`); keep the first line under 72 characters and focus on the behaviour change. Group related modifications per commit and avoid unrelated formatting churn. Pull requests should explain the problem, solution, and verification steps, link relevant issues, attach screenshots or sample payloads when responses change, and flag configuration or database impacts so reviewers can reproduce quickly.

## Environment & Secrets
Manage bindings through `wrangler.toml` and `src/env.ts`; store credentials with `wrangler secret put` and keep `.dev.vars` out of version control. Note new environment keys in your PR so staging stays aligned.

## Database Schema Access
When you need schema details or have any uncertainty about the PostgreSQL layout, query the Postgres MCP server directly—it exposes the canonical Ekubo indexer schema for this worker.

## Complexity Policy
- Run `bun run lint` before considering a change done. CI runs it on every push and
  pull request, before the tests.
- The only rule is ESLint's `complexity`, capped at 10 per function.
- Twenty-three functions are over the limit today, recorded in
  `eslint-suppressions.json`. That file is a ratchet, not an amnesty: ESLint stores a
  per-file count, so a new function over the limit fails the build even in a file
  that already has entries. Do not raise a count to make the build pass — split the
  function.
- If you simplify one of the recorded functions the run will report an unused
  suppression. That is the ratchet working: run `bun run lint:prune` and commit the
  tightened file.
- Nearly all of the debt is route `handleRequest` methods that parse and validate
  query parameters inline before doing the actual work — `prices/index.ts` (30, 20,
  18), `state/poolKeys.ts` (23), `nft/positions.ts` (17). Pulling the parameter
  parsing out into a named parser, the way `parseListPositionsFilters` already does,
  is the obvious way to work these down when the route is next touched.
