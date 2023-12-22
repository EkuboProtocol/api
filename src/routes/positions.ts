import { EkuboAPIRoute } from "./_shared/context";
import { error, IRequest, json } from "itty-router";
import { Env } from "../env";
import { createQueries } from "../queries";
import { num } from "starknet";

export class ListPositions extends EkuboAPIRoute {
  async handle(
    { params: { address: addressStr }, query, url }: IRequest,
    env: Env
  ) {
    let address: bigint;
    try {
      address = BigInt(addressStr);
    } catch (e) {
      return error(400, "Invalid address");
    }

    const showClosed = "showClosed" in query && query.showClosed === "true";

    const client = await createQueries(env);
    const { rows } = await client.getPositionsByAddress(address, showClosed);

    const origin = new URL(url).origin;

    return json(
      {
        data: rows.map((row) => ({
          id: Number(row.token_id),
          pool_key: {
            token0: num.toHex(row.token0),
            token1: num.toHex(row.token1),
            fee: num.toHex(row.fee),
            tick_spacing: num.toHex(row.tick_spacing),
            extension: num.toHex(row.extension),
          },
          bounds: {
            lower: Number(row.lower_bound),
            upper: Number(row.upper_bound),
          },
          metadata_url: `${origin}/${row.token_id}`,
          image: `${origin}/${row.token_id}/image.svg`,
          minted_timestamp: row.minted_timestamp.getTime(),
        })),
      },
      {
        headers: {
          "cache-control": "no-cache",
        },
      }
    );
  }
}
