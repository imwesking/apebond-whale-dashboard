import { describe, expect, it } from "vitest";
import { ApeBondClient } from "../server/apeBondClient";
import { aggregateWhales, normalizeSales } from "../server/aggregation";

const runLive = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!runLive)("live ApeBond reconciliation", () => {
  it("matches this_month unique wallets from source period metadata", async () => {
    const client = new ApeBondClient();
    const period = await client.getPeriodSales("this_month");
    const sales = normalizeSales(period.Sales ?? []);
    const whales = aggregateWhales(sales);
    expect(whales.length).toBe(period.UniqueWallets);
  });
});

