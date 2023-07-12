import { Env } from "./env";
import { Client } from "pg";

export async function createConnectedClient(env: Env): Promise<Client> {
  const client = new Client({
    user: env.PGUSER,
    password: env.PGPASSWORD,
    host: env.PGHOST,
    port: Number(env.PGPORT),
    database: env.PGDATABASE,
    ssl: env.PGCERT
      ? {
          ca: env.PGCERT,
        }
      : false,
  });
  await client.connect();
  return client;
}
