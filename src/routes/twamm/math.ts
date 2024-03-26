import Decimal from "decimal.js-light";

export function sqrtRate(
    saleRateA: bigint,
    saleRateB: bigint,
): Decimal {
    return new Decimal(saleRateA.toString()).mul(saleRateB.toString())
            .sqrt().div((1n << 96n).toString());
}