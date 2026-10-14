# Repository Guidelines

## Project Structure & Module Organization

The TypeScript worker entrypoint is `src/index.ts`; `src/worker.ts` handles the edge cache (including stale-while-revalidate, which the Cache API does not do itself), ETag and CORS, and hands requests to the `OpenAPIHono` app built in `src/router.ts` from the route modules. API domains live under `src/routes/*` (for example `prices`, `quote`, `stats`, `twamm`), each exporting handlers consumed by the router. Shared validation, formatting, and context utilities are in `src/shared`, while `src/env.ts` handles environment bindings and `src/queries.ts` wraps database access. Config lives in `wrangler.toml`, `tsconfig.json`, and `package.json`; coordinate before adding new top-level folders.

## Build, Test, and Development Commands

- `bun install` installs worker dependencies and shared SDKs.
- `bun run start` runs `wrangler dev`, expecting a PostgreSQL instance that matches the Ekubo indexer schema; set secrets with `wrangler secret put`.
- `bun run typecheck` runs TypeScript 7 (`tsc -b`) over every project in the solution `tsconfig.json`: `tsconfig.app.json` covers `src/` and `scripts/`, and `tsconfig.lint.json` covers `scripts/lint.ts`. A new directory of TypeScript needs a project there, or neither the typecheck nor the type-aware lint rules see it correctly.
- `bun run format` formats with oxfmt (`.oxfmtrc.json`); `bun run format:check` is what CI runs.
  Hit `http://127.0.0.1:8787/...` with curl when debugging and watch the console logs for worker output.

## Coding Style & Naming Conventions

Write TypeScript using ES modules, prefer named exports, and keep domain-specific logic inside the matching `src/routes` folder. Formatting is oxfmt (2-space indentation, double quotes, trailing commas, width 80); run `bun run format` before committing. File names stick to lower camel case for utilities (`parseOutTokens.ts`) and kebab-case directories (`src/routes/prices`). Use existing zod schemas as the source of truth for request and response validation rather than duplicating shape definitions.

Routes are `defineRoute(createRoute({...}), handler)` pairs (`@hono/zod-openapi`) registered in `src/router.ts`, where registration order matters for overlapping paths. Declare every parameter the handler uses, with its real default, and read inputs only through `c.req.valid("param" | "query")`. Return `c.json(body, 200, headers)` so the body is type-checked against the declared 200 schema. For other outcomes, throw `StatusError` from `src/shared/errors.ts`; the app renders it as `{ status, error }`. Every route spreads `errorResponses` (400/500), plus `notFoundResponse` if it can 404.

## Testing Guidelines

CI (`.github/workflows/tests.yaml`) runs `bun run format:check`, `bun run lint`, `bun run typecheck` and `bun test` on every push and pull request; every step runs even when an earlier one fails. Two tests guard the published API contract:

- `src/openapiSnapshot.test.ts` compares the app's OpenAPI document (`openApiDocument()` in `src/router.ts`) with the committed `openapi.json`. Any schema change fails it until you run `bun run openapi` and commit the regenerated file, so contract changes show up in review.
- `src/responseSchemas.test.ts` sends a request for every GET operation through the app with every `Queries` method stubbed (fixtures in `src/contract/cases/*`, typed against the query return types), then validates the 200 body against the published schema with objects closed, so undocumented fields fail too. A new route needs a case, or an entry with a reason in `src/contract/uncovered.ts`. A case marked `knownDrift` records a response that does not match its schema; the test fails once the drift is fixed, and then the marker has to go.

Add unit tests for calculations and parsing helpers next to the code as `*.test.ts` (`bun test`). Still exercise changed routes against a real database with `wrangler dev` and list the requests in the PR description.

## Commit & Pull Request Guidelines

Recent commits favour short, lowercase summaries (for example `improve the tokens endpoint`); keep the first line under 72 characters and focus on the behaviour change. Group related modifications per commit and avoid unrelated formatting churn. Pull requests should explain the problem, solution, and verification steps, link relevant issues, attach screenshots or sample payloads when responses change, and flag configuration or database impacts so reviewers can reproduce quickly.

## Environment & Secrets

Manage bindings through `wrangler.toml` and `src/env.ts`; store credentials with `wrangler secret put` and keep `.dev.vars` out of version control. Note new environment keys in your PR so staging stays aligned.

## Database Schema Access

When you need schema details or have any uncertainty about the PostgreSQL layout, query the Postgres MCP server directly—it exposes the canonical Ekubo indexer schema for this worker.

## Complexity and lint policy

- Run `bun run lint` before considering a change done. CI runs it on every push and
  pull request.
- Lint is oxlint (`.oxlintrc.json`), run through `scripts/lint.ts`. It enforces
  `complexity`, capped at 10 per function, and the type-aware rules from
  typescript-eslint's recommended-type-checked set, which oxlint runs through
  `oxlint-tsgolint`. Warnings fail too.
- Fourteen functions are over the complexity limit today, and some files have
  violations of the type-aware rules. They are recorded in `lint-suppressions.json`.
  That file is a ratchet, not an amnesty: it stores a per-file, per-rule count, so a
  new violation fails the build even in a file that already has entries. Do not raise
  a count to make the build pass; split the function or fix the code.
- If you fix a recorded violation the run will report an outdated suppression. That
  is the ratchet working: run `bun run lint:prune` and commit the tightened file.
- Most of the remaining debt is in `src/queries.ts` (8), the TWAMM price projection
  and the NFT SVG/metadata builders. Parameter parsing belongs in the route's zod
  schema, not in the handler.
