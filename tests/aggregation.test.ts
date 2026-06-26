import {
  aggregateWhales,
  buildMonthlyAcquisition,
  buildMonthlyAcquisitionDetail,
  buildSummary,
  filterSales,
  normalizeSales
} from "../server/aggregation";
import { buildPartnerGroups, makePartnerPath } from "../server/partners";
import { parseWhaleQuery } from "../server/query";
import { getTierLabel } from "../server/tiers";
import type { ApeBondSale, NormalizedSale } from "../server/types";

const sales: ApeBondSale[] = [
  {
    lp: "USDC-ELON",
    contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    createdAddressOwner: "0x1111111111111111111111111111111111111111",
    createdAt: 100,
    dollarValue: 50,
    payout: 100,
    tier: 1,
    chainId: 56,
    transactionHash: "0xaaa",
    payoutToken: "ELON"
  },
  {
    lp: "USDC-ELON",
    contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    createdAddressOwner: "0x1111111111111111111111111111111111111111",
    createdAt: 100,
    dollarValue: 50,
    payout: 100,
    tier: 1,
    chainId: 56,
    transactionHash: "0xaaa",
    payoutToken: "ELON"
  },
  {
    lp: "USDC-QONE",
    contractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    createdAddressOwner: "0x1111111111111111111111111111111111111111",
    createdAt: 200,
    dollarValue: 7,
    payout: 20,
    tier: 3,
    chainId: 999,
    transactionHash: "0xbbb",
    payoutToken: "QONE"
  },
  {
    lp: "USDC-ACN",
    contractAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    createdAddressOwner: "0x2222222222222222222222222222222222222222",
    createdAt: 150,
    dollarValue: 100,
    payout: 20,
    tier: null,
    chainId: 1,
    transactionHash: "0xccc",
    payoutToken: "ACN"
  }
];

describe("aggregation", () => {
  it("deduplicates sales and aggregates wallet totals", () => {
    const normalized = normalizeSales(sales);
    expect(normalized).toHaveLength(3);

    const whales = aggregateWhales(normalized);
    expect(whales[0]).toMatchObject({
      wallet: "0x2222222222222222222222222222222222222222",
      totalVolumeUsd: 100,
      totalBuys: 1,
      totalBonds: 1,
      tierLabel: "No tier"
    });

    expect(whales[1]).toMatchObject({
      wallet: "0x1111111111111111111111111111111111111111",
      totalVolumeUsd: 57,
      totalBuys: 2,
      totalBonds: 2,
      lastBuyAt: 200,
      lastBuyUsd: 7,
      tierLabel: "Diamond"
    });
  });

  it("filters low value buys, chain, tier, and wallet search", () => {
    const normalized = normalizeSales(sales);
    expect(filterSales(normalized, { hideLowValue: true })).toHaveLength(2);
    expect(filterSales(normalized, { chainId: 999 })).toHaveLength(1);
    expect(filterSales(normalized, { partnerKeys: ["999::qone"] })).toHaveLength(1);
    expect(filterSales(normalized, { partnerKeys: [] })).toHaveLength(0);
    expect(filterSales(normalized, { tier: "none" })).toHaveLength(1);
    expect(filterSales(normalized, { q: "2222" })).toHaveLength(1);
    expect(filterSales(normalized, { dateFrom: 150, dateTo: 199 })).toHaveLength(1);
  });

  it("builds monthly first-time buyer acquisition from all-time sales", () => {
    const normalized: NormalizedSale[] = [
      makeNormalizedSale("0x1111111111111111111111111111111111111111", "2026-01-10", 100, "a"),
      makeNormalizedSale("0x1111111111111111111111111111111111111111", "2026-02-12", 50, "b"),
      makeNormalizedSale("0x2222222222222222222222222222222222222222", "2026-02-14", 200, "c"),
      makeNormalizedSale("0x2222222222222222222222222222222222222222", "2026-02-20", 40, "d"),
      makeNormalizedSale("0x1111111111111111111111111111111111111111", "2026-04-02", 25, "e")
    ];

    const rows = buildMonthlyAcquisition(normalized);

    expect(rows.map((row) => row.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(rows[0]).toMatchObject({
      firstTimeBuyerVolumeUsd: 100,
      repeatBuyerVolumeUsd: 0,
      firstTimeBuyerVolumeSharePct: 100,
      firstTimeBuyers: 1,
      repeatBuyers: 0
    });
    expect(rows[1]).toMatchObject({
      totalVolumeUsd: 290,
      firstTimeBuyerVolumeUsd: 240,
      repeatBuyerVolumeUsd: 50,
      firstTimeBuyers: 1,
      repeatBuyers: 1,
      firstTimeBuys: 2,
      repeatBuys: 1
    });
    expect(rows[1].firstTimeBuyerVolumeSharePct).toBeCloseTo(82.7586, 4);
    expect(rows[2]).toMatchObject({
      totalVolumeUsd: 0,
      firstTimeBuyerVolumeSharePct: 0,
      totalBuyers: 0
    });
    expect(rows[3]).toMatchObject({
      firstTimeBuyerVolumeUsd: 0,
      repeatBuyerVolumeUsd: 25,
      repeatBuyers: 1
    });
  });

  it("builds monthly acquisition wallet drilldown with purchases", () => {
    const normalized: NormalizedSale[] = [
      makeNormalizedSale("0x1111111111111111111111111111111111111111", "2026-01-10", 100, "a"),
      makeNormalizedSale("0x1111111111111111111111111111111111111111", "2026-02-12", 50, "b"),
      makeNormalizedSale("0x2222222222222222222222222222222222222222", "2026-02-14", 200, "c"),
      makeNormalizedSale("0x2222222222222222222222222222222222222222", "2026-02-20", 40, "d")
    ];

    const detail = buildMonthlyAcquisitionDetail(normalized, "2026-02");

    expect(detail.summary).toMatchObject({
      month: "2026-02",
      totalVolumeUsd: 290,
      firstTimeBuyerVolumeUsd: 240,
      repeatBuyerVolumeUsd: 50,
      firstTimeBuyers: 1,
      repeatBuyers: 1
    });
    expect(detail.wallets.map((wallet) => wallet.wallet)).toEqual([
      "0x2222222222222222222222222222222222222222",
      "0x1111111111111111111111111111111111111111"
    ]);
    expect(detail.wallets[0]).toMatchObject({
      buyerType: "first_time",
      monthVolumeUsd: 240,
      monthBuys: 2,
      monthBonds: 1
    });
    expect(detail.wallets[0].purchases.map((purchase) => purchase.key)).toEqual(["d", "c"]);
    expect(detail.wallets[1]).toMatchObject({
      buyerType: "repeat",
      monthVolumeUsd: 50,
      monthBuys: 1
    });
  });

  it("sorts wallets by primary and secondary sort keys", () => {
    const normalized = normalizeSales([
      ...sales,
      {
        lp: "USDC-APE",
        contractAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        createdAddressOwner: "0x3333333333333333333333333333333333333333",
        createdAt: 250,
        dollarValue: 200,
        payout: 20,
        tier: 3,
        chainId: 56,
        transactionHash: "0xddd",
        payoutToken: "APE"
      }
    ]);

    const byTierThenVolume = aggregateWhales(normalized, "tier_desc", "volume_desc");
    expect(byTierThenVolume.map((wallet) => wallet.wallet)).toEqual([
      "0x3333333333333333333333333333333333333333",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222"
    ]);

    const byLastBuyUsd = aggregateWhales(normalized, "last_buy_usd_desc");
    expect(byLastBuyUsd[0].wallet).toBe("0x3333333333333333333333333333333333333333");
  });

  it("rejects secondary sorts that use the same field as primary", () => {
    expect(parseWhaleQuery({ sort: "volume_desc", secondarySort: "volume_asc" }).secondarySort).toBeUndefined();
    expect(parseWhaleQuery({ sort: "tier_desc", secondarySort: "volume_desc" }).secondarySort).toBe("volume_desc");
  });

  it("parses inclusive date ranges from calendar input values", () => {
    const query = parseWhaleQuery({ dateFrom: "1970-01-01", dateTo: "1970-01-01" });
    expect(query.dateFrom).toBe(0);
    expect(query.dateTo).toBe(86_399);
    expect(() => parseWhaleQuery({ dateFrom: "1970-01-02", dateTo: "1970-01-01" })).toThrow("Invalid date range");
    expect(() => parseWhaleQuery({ dateFrom: "1970-13-01" })).toThrow("Invalid dateFrom");
  });

  it("maps ApeBond tiers", () => {
    expect(getTierLabel(0)).toBe("Bronze");
    expect(getTierLabel(2)).toBe("Gold");
    expect(getTierLabel(5)).toBe("Mythical");
    expect(getTierLabel(null)).toBe("No tier");
  });

  it("groups bonds by payout token and chain for partner pages", () => {
    const groups = buildPartnerGroups([
      {
        lp: "USDC-ACN",
        payoutToken: "ACN",
        contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainId: 1,
        totalSales: 3,
        totalDollarValue: 300,
        soldOut: true,
        lastPurchaseDate: { createdAt: 300 }
      },
      {
        lp: "USDC-ACN",
        payoutToken: "ACN",
        contractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        chainId: 56,
        totalSales: 2,
        totalDollarValue: 200,
        lastPurchaseDate: { createdAt: 200 }
      },
      {
        lp: "USDC-ACN",
        payoutToken: "ACN",
        contractAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        chainId: 1,
        totalSales: 4,
        totalDollarValue: 400,
        lastPurchaseDate: { createdAt: 400 }
      }
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].partner.label).toBe("ACN on Ethereum");
    expect(groups[0].partner.totalBonds).toBe(2);
    expect(groups[0].partner.totalVolumeUsd).toBe(700);
    expect(groups[0].partner.soldOutBonds).toBe(1);
    expect(makePartnerPath(groups[0].partner.chainId, groups[0].partner.token)).toBe("/partner/1/ACN");
  });

  it("summarizes large all-time indexes without spreading arrays onto the stack", () => {
    const largeSales: NormalizedSale[] = Array.from({ length: 150_000 }, (_, index) => ({
      key: `56:0x${index}`,
      lp: "USDC-APE",
      contractAddress: `0x${String(index % 500).padStart(40, "0")}`,
      wallet: `0x${String(index % 10_000).padStart(40, "0")}`,
      createdAt: 1_700_000_000 + index,
      dollarValue: 2,
      payout: 1,
      payoutTokenPrice: 1,
      tier: index % 6,
      chainId: 56,
      transactionHash: `0x${index}`,
      payoutToken: "APE"
    }));

    const whales = aggregateWhales(largeSales);
    const summary = buildSummary("all", largeSales, whales);

    expect(summary.totalBuys).toBe(150_000);
    expect(summary.uniqueWallets).toBe(10_000);
    expect(summary.uniqueBonds).toBe(500);
    expect(summary.lastBuyAt).toBe(1_700_149_999);
    expect(summary.totalVolumeUsd).toBe(300_000);
  });
});

function makeNormalizedSale(wallet: string, isoDate: string, dollarValue: number, key: string): NormalizedSale {
  return {
    key,
    lp: "USDC-APE",
    contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    wallet,
    createdAt: Math.floor(Date.parse(`${isoDate}T00:00:00.000Z`) / 1000),
    dollarValue,
    payout: 1,
    payoutTokenPrice: 1,
    tier: null,
    chainId: 56,
    transactionHash: `0x${key}`,
    payoutToken: "APE"
  };
}
