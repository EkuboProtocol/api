import { z } from "@hono/zod-openapi";
import { StatusError } from "../../shared/errors";

const MIN_EVENT_ID = -(1n << 63n);
const MAX_EVENT_ID = (1n << 63n) - 1n;
const MAX_BLOCK = (1n << 32n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_CURSOR_LENGTH = 2048;

function decimal(min: bigint, max: bigint) {
  return z
    .string()
    .max(78)
    .regex(/^(?:0|-?[1-9]\d*)$/)
    .refine((value) => {
      const number = BigInt(value);
      return number >= min && number <= max;
    });
}

export const historyLimit = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .prefault("25")
  .openapi({ type: "integer", minimum: 1, maximum: 100, default: 25 });

export const historyCursor = z
  .string()
  .max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional();

export const historySnapshot = z.strictObject({
  block_number: decimal(0n, MAX_BLOCK),
  block_hash: decimal(0n, MAX_UINT256),
  fork_counter: decimal(0n, MAX_EVENT_ID),
});

export type HistorySnapshot = z.infer<typeof historySnapshot>;

const cursorSchema = z.strictObject({
  v: z.literal(1),
  chain_id: decimal(1n, MAX_EVENT_ID),
  locker: decimal(0n, MAX_UINT256),
  id: decimal(0n, MAX_UINT256),
  limit: z.number().int().min(1).max(100),
  snapshot: historySnapshot,
  last_nonempty_block: decimal(0n, MAX_BLOCK).nullable(),
  event_id: decimal(MIN_EVENT_ID + 1n, MAX_EVENT_ID),
  source_type: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
});

export type HistoryCursor = z.infer<typeof cursorSchema>;
type Scope = Pick<HistoryCursor, "chain_id" | "locker" | "id" | "limit">;

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function parse(token: string) {
  try {
    const raw = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = cursorSchema.parse(JSON.parse(raw));
    return encodeHistoryCursor(parsed) === token ? parsed : null;
  } catch {
    return null;
  }
}

export function decodeHistoryCursor(
  token: string,
  scope: Scope,
): HistoryCursor {
  const cursor = parse(token);
  if (
    !cursor ||
    cursor.chain_id !== scope.chain_id ||
    cursor.locker !== scope.locker ||
    cursor.id !== scope.id ||
    cursor.limit !== scope.limit
  ) {
    throw new StatusError(400, "Invalid history cursor");
  }
  const block = (BigInt(cursor.event_id) - MIN_EVENT_ID - 1n) >> 32n;
  if (block > BigInt(cursor.snapshot.block_number)) {
    throw new StatusError(400, "Invalid history cursor");
  }
  return cursor;
}
