import { ContractCase, stubQuery } from "../harness";
import { tokenRow, USDC, WETH, WETH_DECIMAL } from "../fixtures";

const block = {
  number: "21000000",
  hash: "0xabc",
  timestamp: "2024-10-18T12:00:00.000Z",
};

export const metaCases: ContractCase[] = [
  {
    operation: "/tokens",
    request: "/tokens?chainId=1",
    stub: () =>
      stubQuery("listErc20Tokens", [
        tokenRow(),
        tokenRow({
          token_address: WETH_DECIMAL,
          token_symbol: "WETH",
          total_supply: null,
          usd_price: null,
          bridge_infos: null,
        }),
      ]),
  },
  {
    operation: "/tokens/batch",
    request: `/tokens/batch?id=1:${USDC}&id=0x1:${WETH}`,
    stub: () =>
      stubQuery("getErc20TokensByIds", [
        tokenRow(),
        tokenRow({ token_address: WETH_DECIMAL, token_symbol: "WETH" }),
      ]),
  },
  {
    operation: "/tokens/prices",
    request: "/tokens/prices?chainId=1",
    stub: () =>
      stubQuery("listErc20TokenUsdPrices", [
        { token_address: WETH_DECIMAL, usd_price: 2500.5 },
      ]),
  },
  {
    operation: "/tokens/{chainId}/{tokenAddress}",
    request: `/tokens/1/${USDC}`,
    stub: () => stubQuery("getErc20TokenByAddress", tokenRow()),
  },
  {
    operation: "/blocks/{chainId}/closest",
    request: "/blocks/1/closest?timestamp=2024-10-18T12:00:00Z",
    stub: () => stubQuery("getBlockAtOrAfter", block),
  },
  {
    operation: "/blocks/{chainId}/{blockTag}",
    request: "/blocks/1/latest",
    stub: () => stubQuery("getLatestBlock", block),
  },
  {
    operation: "/country",
    request: "/country",
  },
];
