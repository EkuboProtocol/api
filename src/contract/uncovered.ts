// Operations the contract test cannot reach through stubbed Queries, with
// where their responses are checked instead.
const IDENTITY =
  "Backed by the identity D1, not Queries: src/routes/identity/identity.test.ts checks its 200 bodies against the published schema";

export const UNCOVERED_OPERATIONS: Record<string, string> = {
  "/v1/identity/x/callback": "Returns HTML or a redirect, not JSON",
  "/v1/identity/x/link/{link_id}": IDENTITY,
  "/v1/identity/addresses": IDENTITY,
};
