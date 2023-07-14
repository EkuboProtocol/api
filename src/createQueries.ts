import { Env } from "./env";
import { Client } from "pg";
import { CERTIFICATE_AUTHORITIES } from "./certs";
import { Queries } from "./queries";

export async function createQueries(env: Env) {
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

  try {
    await client.connect();
  } catch (error) {
    console.error(error);
    throw new Error("Failed to connect to database");
  }

  return new Queries(client);
}
