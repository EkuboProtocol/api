# Ekubo API

This repository contains the code for the [Ekubo API](https://docs.ekubo.org/integration-guides/reference/ekubo-api), which powers all aspects of the [interface](https://app.ekubo.org/).

# Running local

All you need to run this API locally is a database containing the schema defined in the [EkuboProtocol/indexer](https://github.com/EkuboProtocol/indexer) repository. [Follow instructions]([https://github.com/EkuboProtocol/indexer/actions/workflows/backup.yml](https://github.com/EkuboProtocol/indexer?tab=readme-ov-file#syncing-a-new-node)) in the indexer repo to set up the database.

Once you have a database, update the PG_CONNECTION_STRING in [wrangler.toml](./wrangler.toml), run `npm install`, and then `npm start`.

Run the indexer as well to keep your database up-to-date with the latest data.
