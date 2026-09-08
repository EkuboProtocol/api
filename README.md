# Ekubo API

This repository contains the code for the [Ekubo API](https://docs.ekubo.org/integration-guides/reference/ekubo-api), which powers all aspects of the [interface](https://app.ekubo.org/).

# Running local

All you need to run this API locally is a database containing the schema defined in the [EkuboProtocol/indexer](https://github.com/EkuboProtocol/indexer) repository. [Follow instructions](https://github.com/EkuboProtocol/indexer?tab=readme-ov-file#syncing-a-new-node) in the indexer repo to set up the database.

Once you have a database that is populated with data, run `bun install`, and then `bun run start`.

The local connection string defaults to `postgresql://postgres:postgres@localhost:5432/postgres`
via `[vars]` in `wrangler.toml`. Override it by putting `PG_CONNECTION_STRING`
in a `.dev.vars` file, which is gitignored.

# Deploying your own

`wrangler.toml` is configured for Ekubo's own Cloudflare account, so a
self-hosted deployment needs three changes under `[env.prod]`:

- **`hyperdrive.id`** — the `c6bd83f2…` binding points at Ekubo's
  [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) config. Create your
  own over your indexer database (`wrangler hyperdrive create`) and use that id.
  Hyperdrive holds the database credential, which is why none appears here.
- **`routes`** — `prod-api.ekubo.org` is a custom domain on Ekubo's zone. Point
  it at a domain you control, or drop the block and use the `workers.dev` URL.
- **`name`** — `ekubo-api` is the Worker name within an account; change it if it
  collides.

The Worker needs no secrets of its own: the only bindings it reads are
`HYPERDRIVE` in production and `PG_CONNECTION_STRING` locally. Deployment from
CI additionally uses the `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository
secrets; the deploy job is skipped on forks, so tests still run green without
them.

# License

MIT — see [LICENSE](./LICENSE).
