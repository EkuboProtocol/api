import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ContractCase,
  fetchRoute,
  stubAllQueriesToThrow,
} from "./contract/harness";
import { nftCases } from "./contract/cases/nft";

const caseFor = (operation: string): ContractCase => {
  const contractCase = nftCases.find((c) => c.operation === operation);
  if (contractCase === undefined) throw new Error(`No case for ${operation}`);
  return contractCase;
};

// The ERC721 metadata routes link to their own image routes, so the image URL
// in each metadata response must resolve to a 200 SVG.
describe("NFT metadata image links resolve to the image routes", () => {
  beforeEach(stubAllQueriesToThrow);
  afterEach(() => mock.restore());

  test.each(["/positions", "/orders", "/nft"])("%s", async (prefix) => {
    const metadataCase = caseFor(`${prefix}/{chainId}/{nftAddress}/{id}`);
    const imageCase = caseFor(
      `${prefix}/{chainId}/{nftAddress}/{id}/image.svg`,
    );

    metadataCase.stub?.();
    const metadataResponse = await fetchRoute(metadataCase.request);
    expect(metadataResponse.status).toBe(200);
    const { image } = (await metadataResponse.json()) as { image: string };

    const imageUrl = new URL(image);
    expect(imageUrl.origin).toBe("http://localhost");
    expect(imageUrl.pathname).toBe(`${metadataCase.request}/image.svg`);

    mock.restore();
    stubAllQueriesToThrow();
    imageCase.stub?.();
    const imageResponse = await fetchRoute(imageUrl.pathname);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toStartWith(
      "image/svg+xml",
    );
  });
});
