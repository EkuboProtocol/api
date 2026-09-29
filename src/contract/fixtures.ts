import type { RawErc20TokenRow } from "../queries";

// Shared fixture values. Addresses and numerics are strings because that is
// how postgres returns NUMERIC columns; int8 columns come back as bigint.
export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const USDC_DECIMAL = BigInt(USDC).toString();
export const WETH_DECIMAL = BigInt(WETH).toString();
export const CORE = "0xe0e0e08a6a4b9dc7bd67bcb7aade5cf48157d444";
export const CORE_DECIMAL = BigInt(CORE).toString();
export const OWNER = "0x1234567890abcdef1234567890abcdef12345678";
// A data: URL keeps the SVG generators' logo fetch off the network.
export const LOGO = "data:image/png;base64,iVBORw0KGgo=";

export const tokenRow = (
  overrides: Partial<RawErc20TokenRow> = {},
): RawErc20TokenRow => ({
  chain_id: 1n,
  token_address: USDC_DECIMAL,
  token_symbol: "USDC",
  token_name: "USD Coin",
  token_decimals: 6,
  logo_url: LOGO,
  visibility_priority: 1,
  sort_order: 0,
  total_supply: "1000000000000",
  usd_price: "1.0001",
  bridge_infos: { "23448594291968334": { bridge_address: "0x1234" } },
  ...overrides,
});

export const wethRow = (
  overrides: Partial<RawErc20TokenRow> = {},
): RawErc20TokenRow =>
  tokenRow({
    token_address: WETH_DECIMAL,
    token_symbol: "WETH",
    token_name: "Wrapped Ether",
    token_decimals: 18,
    usd_price: "2500.5",
    ...overrides,
  });

export const pairTokens = [tokenRow(), wethRow()];
