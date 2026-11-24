# Wallet to X links: operations

## Removing a link on a report

Use this when someone reports that a wallet shows their X handle without
their consent (for example, it was linked while their X account was
compromised), or a link is otherwise abusive.

1. **Point the owner to self-service first.** The owner of the X account
   can remove every link to it themselves: `POST /v1/identity/x/unlink/start`,
   sign in with X, then `POST /v1/identity/x/unlink/{unlink_id}/complete` with
   the code shown. This needs no wallet. Act yourself only when they cannot
   (for example, they have not recovered the account yet) or the report is
   about the address rather than the X account.
2. **Confirm the link exists.** Look it up and note `x_user_id`, the
   address and the chain:

   ```sh
   curl 'https://prod-api.ekubo.org/v1/identity/addresses?chainId=1&address=0x...'
   ```

   Lookups are cached for 30 seconds.

3. **Remove it**, archiving to `link_history` with the end reason `removed`.
   The commands name the production database `ekubo-identity`; use the name
   bound in `env.prod`, or `ekubo-identity-preview --env preview` on preview. Put the values in as literals after checking
   them: the X user ID is digits only, the address `0x` and lowercase hex.

   Every link to one X account:

   ```sh
   npx wrangler d1 execute ekubo-identity --env prod --remote --command "
     INSERT INTO link_history (namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ended_at, end_reason)
       SELECT namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, unixepoch(), 'removed'
       FROM links WHERE x_user_id = '<x_user_id>';
     DELETE FROM link_attempts WHERE x_user_id = '<x_user_id>';
     DELETE FROM links WHERE x_user_id = '<x_user_id>';"
   ```

   One address only (every chain; add `AND chain_scope = '<chain id>'` to
   both `WHERE` clauses for a single contract-account link):

   ```sh
   npx wrangler d1 execute ekubo-identity --env prod --remote --command "
     INSERT INTO link_history (namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, ended_at, end_reason)
       SELECT namespace, address, chain_scope, x_user_id, x_handle, signature_kind, verified_chain_id, linked_at, unixepoch(), 'removed'
       FROM links WHERE namespace = 'evm' AND address = '<address>';
     DELETE FROM links WHERE namespace = 'evm' AND address = '<address>';"
   ```

4. **Check** the lookup again after 30 seconds: the address shows `null`.
5. **Record** who reported it, which link was removed and why in the report
   ticket. Nothing in the database stores the reporter.

Removal does not stop the same X account and wallet linking again. If the
report is about an X account that is still compromised, the owner should
remove the links themselves once they have it back.

## Launch configuration

Production (`env.prod` in `wrangler.toml`) has no identity database, so the
identity routes answer 503 there. Turning them on is one change, which adds:

- the production `IDENTITY_DB` D1 binding, with both migrations applied
  before the deploy;
- both `ratelimits` bindings (`IDENTITY_IP_LIMITER`, `IDENTITY_ADDRESS_LIMITER`).
  Without either, the routes answer 503 rather than running unlimited;
- `PUBLIC_ORIGIN = "https://prod-api.ekubo.org"`, and the callback URL
  registered with the X app;
- `X_LINK_RETURN_ORIGINS` with exact origins only (`https://ekubo.org`): no
  `*.` wildcard, no localhost;
- `X_CLIENT_ID` and `X_CLIENT_SECRET` as Worker secrets;
- `RPC_URLS` (secret) naming a provider Ekubo has an account with for every
  supported chain. Contract-account signatures (ERC-1271, ERC-6492, Starknet)
  are checked by `eth_call`/`starknet_call` at `latest`, and a wrong answer
  from the RPC would link any address on that chain, so the public defaults
  in `chains.ts` are not acceptable in production.
