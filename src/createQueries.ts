import { Env } from "./env";
import { Client } from "pg";
import { Queries } from "./queries";

export async function createQueries(env: Env) {
  const client = new Client({
    connectionString: env.PG_CONNECTION_STRING,
    ssl: false,
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(error);
    throw new Error("Failed to connect to database");
  }

  return new Queries(client);
}
