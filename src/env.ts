// declare what's available in our env
export interface Env {
  STARKNET_CHAIN_ID: "0x534e5f474f45524c49" | "0x534e5f4d41494e";

  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
  PGCERT?: string;
}
