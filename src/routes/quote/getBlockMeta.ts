import { Queries } from "../../queries";
import { QuoteMeta } from "@ekubo/sdk";

export async function getBlockMeta(queries: Queries): Promise<QuoteMeta> {
  const block = await queries.getLatestBlockMeta();

  const ageLastBlockSeconds = Math.floor(
    (Date.now() - block.time.getTime()) / 1000,
  );

  // the current block ceiling deadline is 6 minutes, so we can estimate the current block number,
  // based on the age of the latest block in 6 minute intervals.
  // this is a lower bound on the actual pending block timestamp
  const estimatedNumberOfBlocksBehind = Math.floor(ageLastBlockSeconds / 360);

  return {
    block: {
      number: block.number + estimatedNumberOfBlocksBehind,
      time: block.time.getTime() / 1000 + estimatedNumberOfBlocksBehind * 360,
    },
  };
}
