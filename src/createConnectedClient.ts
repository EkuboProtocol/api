import { Env } from "./env";
import { Client } from "pg";
import { CERTIFICATE_AUTHORITIES } from "./certs";

export async function createConnectedClient(env: Env): Promise<Client> {
  const ca = env.PGCERT ? CERTIFICATE_AUTHORITIES[env.PGCERT] : null;

  const client = new Client({
    user: env.PGUSER,
    password: env.PGPASSWORD,
    host: env.PGHOST,
    port: Number(env.PGPORT),
    database: env.PGDATABASE,
    ssl: ca
      ? {
          ca,
        }
      : false,
  });
  await client.connect();
  return client;
}
