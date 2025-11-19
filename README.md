# Ekubo API

This repository contains the code for the [Ekubo API](https://docs.ekubo.org/integration-guides/reference/ekubo-api), which powers all aspects of the [interface](https://app.ekubo.org/).

# Running local

All you need to run this API locally is a database containing the schema defined in the [EkuboProtocol/indexer](https://github.com/EkuboProtocol/indexer) repository. [Follow instructions](https://github.com/EkuboProtocol/indexer?tab=readme-ov-file#syncing-a-new-node) in the indexer repo to set up the database.

Once you have a database that is populated with data, run `bun install`, and then `bun run start`.
