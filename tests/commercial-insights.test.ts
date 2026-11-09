import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCommercialInsights, parseCommercialMonth } from "../server/commercialInsights";
import { DashboardService } from "../server/dashboardService";
import { createServer } from "../server/index";
import type { ApeBondDataClient } from "../server/apeBondClient";
import type { ApeBondSale, ApeBondSalesInfo, NormalizedSale } from "../server/types";

const SNAPSHOT = "2026-11-06T04:00:00.000Z";
const NOW = new Date("2026-11-06T12:00:00.000Z");
const seconds = (date: string) => Date.parse(date.includes("T") ? date : `${date}T00:00:00.000Z`) / 1000;

function sale(wallet: string, date: string, dollarValue: number, token = "APE", chainId = 56): NormalizedSale {
  return {
    key: `${wallet}:${date}:${dollarValue}:${token}:${chainId}`,
    wallet,
    createdAt: seconds(date),
    dollarValue,
    chainId,
    contractAddress: `0x${token.toLowerCase()}${chainId}`,
    lp: `USDC-${token}`,
    payoutToken: token,
    payout: 1,
    payoutTokenPrice: 1,
    tier: null,
    transactionHash: null
  };
}

function build(sales: NormalizedSale[], month?: string, catalogueBonds: ApeBondSale[] = []) {
  return buildCommercialInsights(sales, {
    month, salesAsOf: SNAPSHOT, catalogueAsOf: "2026-11-06T11:59:00.000Z", catalogueBonds, now: NOW
  });
}

describe("commercial insights aggregation", () => {
  it("uses the latest completed month covered by the snapshot, including terminal zero months", () => {
    const result = buildCommercialInsights([sale("old", "2026-05-05", 50)], {
      salesAsOf: SNAPSHOT, catalogueAsOf: null, now: new Date("2026-12-12T00:00:00Z")
    });
    expect(result.month).toBe("2026-10");
    expect(result.availableMonths).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(result.summary).toMatchObject({ volumeUsd: 0, buyers: 0, purchases: 0, averagePurchaseUsd: null, medianPurchaseUsd: null });
    expect(result.trend.map((row) => [row.month, row.volumeUsd])).toEqual([
      ["2026-05", 50], ["2026-06", 0], ["2026-07", 0], ["2026-08", 0], ["2026-09", 0], ["2026-10", 0]
    ]);
    expect(result.quality.stale).toBe(true);
    expect(result.concentration.top1WalletPct).toBeNull();
  });

  it("validates calendar months, available coverage, query shapes and a January boundary", () => {
    for (const invalid of ["2026-00", "2026-13", "2026-1", "2026-10-01", ["2026-10"], { month: "2026-10" }]) {
      expect(() => parseCommercialMonth(invalid)).toThrow("Invalid month");
    }
    expect(() => build([sale("a", "2026-05-01", 1)], "2026-11")).toThrow("Invalid month");
    expect(() => build([sale("a", "2026-05-01", 1)], "2026-04")).toThrow("Invalid month");
    const january = buildCommercialInsights([sale("a", "2025-10-01", 1)], {
      salesAsOf: "2026-01-01T00:00:00Z", catalogueAsOf: null, now: NOW
    });
    expect(january.month).toBe("2025-12");
    expect(january.period.end).toBe(seconds("2026-01-01"));
  });

  it("uses complete UTC months, true previous/year-ago periods and lifetime first observed purchases", () => {
    const result = build([
      sale("returning", "2025-10-20", 20),
      sale("returning", "2026-09-30T23:59:59Z", 50),
      sale("returning", "2026-10-01T00:00:00Z", 100),
      sale("new", "2026-10-02", 10),
      sale("new", "2026-10-31T23:59:59Z", 30),
      sale("future", "2026-11-01T00:00:00Z", 9999)
    ]);
    expect(result.summary).toEqual({
      volumeUsd: 140, buyers: 2, purchases: 3, averagePurchaseUsd: 140 / 3, medianPurchaseUsd: 30,
      newBuyers: 1, returningBuyers: 1, newVolumeUsd: 40, returningVolumeUsd: 100
    });
    expect(result.comparisons.previous?.volumeUsd).toBe(50);
    expect(result.comparisons.yearAgo?.volumeUsd).toBe(20);
    expect(result.period.start).toBe(seconds("2026-10-01"));
    expect(result.period.end).toBe(seconds("2026-11-01"));
  });

  it("keeps unavailable historical comparisons distinct from zero activity and calculates an even median", () => {
    const result = build([sale("a", "2026-10-02", 20), sale("b", "2026-10-03", 40)]);
    expect(result.summary.medianPurchaseUsd).toBe(30);
    expect(result.comparisons.previous).toBeNull();
    expect(result.comparisons.yearAgo).toBeNull();
    expect(result.products[0].changePct).toBeNull();
    expect(result.trend[0].available).toBe(false);
    expect(result.period.available).toBe(true);
  });

  it("uses purchase thresholds, keeps chain identities and reconciles exclusive small-only wallets", () => {
    const result = build([
      sale("tiny", "2026-10-02", 4), sale("tiny", "2026-10-03", 5),
      sale("mixed", "2026-10-02", 2), sale("mixed", "2026-10-03", 10),
      sale("hundred", "2026-10-04", 100, "APE", 4663),
      sale("thousand", "2026-10-05", 1000, "APE", 10143)
    ]);
    expect(result.buyerSegments.thresholds).toEqual([
      { minimumUsd: 10, wallets: 3 }, { minimumUsd: 100, wallets: 2 }, { minimumUsd: 1000, wallets: 1 }
    ]);
    expect(result.buyerSegments.smallOnly).toEqual({ wallets: 1, volumeUsd: 9 });
    expect(result.summary.volumeUsd).toBe(1121);
    expect(result.products).toHaveLength(3);
    expect(result.products.find((row) => row.chainId === 4663)?.chainLabel).toBe("Robinhood Chain");
    expect(result.products.some((row) => row.chainId === 10143)).toBe(true);
    expect(result.products.reduce((sum, row) => sum + row.volumeUsd, 0)).toBe(result.summary.volumeUsd);
    expect(result.concentration.top1WalletPct).toBeCloseTo(1000 / 1121 * 100);
    expect(result.concentration.top5WalletPct).toBe(100);
  });

  it("includes disappeared products and never creates percentage changes against zero", () => {
    const result = build([
      sale("a", "2026-09-01", 100, "OLD"), sale("b", "2026-10-01", 200, "NEW")
    ]);
    expect(result.products.find((row) => row.token === "OLD")).toMatchObject({
      volumeUsd: 0, previousVolumeUsd: 100, changeUsd: -100, changePct: -100, buyers: 0, purchases: 0
    });
    expect(result.products.find((row) => row.token === "NEW")).toMatchObject({
      volumeUsd: 200, previousVolumeUsd: 0, changeUsd: 200, changePct: null
    });
  });

  it("deduplicates catalogue contracts, preserves missing states and reports conflicts as unknown", () => {
    const bonds: ApeBondSale[] = [
      { contractAddress: "0xape56", payoutToken: "APE", chainId: 56, soldOut: true },
      { contractAddress: "0xAPE56", payoutToken: "APE", chainId: 56, soldOut: true },
      { contractAddress: "0xconflict", payoutToken: "APE", chainId: 56, soldOut: true },
      { contractAddress: "0xconflict", payoutToken: "APE", chainId: 56, soldOut: false },
      { contractAddress: "0xmissing", payoutToken: "APE", chainId: 56 },
      { contractAddress: "0xopen", payoutToken: "APE", chainId: 56, soldOut: false }
    ];
    const result = build([sale("a", "2026-10-01", 1)], undefined, bonds);
    expect(result.products[0].catalogue).toEqual({ soldOut: 1, notSoldOut: 1, unknown: 2 });
    expect(build([sale("a", "2026-10-01", 1)]).products[0].catalogue).toEqual({ soldOut: 0, notSoldOut: 0, unknown: 1 });
  });

  it("selects inactive repeat buyers over the preceding 12 calendar months without future leakage", () => {
    const rows = [
      sale("inactive", "2025-10-01", 100), sale("inactive", "2026-05-15", 200),
      sale("inactive", "2026-11-02", 999999),
      sale("one-month", "2026-09-01", 300), sale("one-month", "2026-09-02", 300),
      sale("outside", "2025-09-30T23:59:59Z", 1000), sale("outside", "2026-05-15", 10),
      sale("current", "2026-01-01", 20), sale("current", "2026-05-01", 30), sale("current", "2026-10-01", 1),
      sale("future-only", "2026-11-01", 500), sale("future-only", "2026-12-01", 500)
    ];
    const result = build(rows);
    expect(result.wallets.totalInactive).toBe(1);
    expect(result.wallets.inactive[0]).toMatchObject({
      wallet: "inactive", volumeUsd: 300, purchases: 2, activeMonths: 2, lastBuyAt: seconds("2026-05-15")
    });
    expect(result.wallets.current[0]).toMatchObject({ wallet: "current", volumeUsd: 1, purchases: 1, activeMonths: 1 });
    expect(result.wallets.lookbackStart).toBe(seconds("2025-10-01"));
    expect(result.wallets.lookbackEnd).toBe(seconds("2026-10-01"));
  });

  it("limits wallet payloads to 20 while retaining full counts, totals and product preferences", () => {
    const rows = Array.from({ length: 25 }, (_, index) => sale(`wallet-${index}`, "2026-10-02", index + 1));
    const result = build(rows);
    expect(result.wallets.current).toHaveLength(20);
    expect(result.wallets.totalCurrent).toBe(25);
    expect(result.summary.buyers).toBe(25);
    expect(result.wallets.current[0]).toMatchObject({ wallet: "wallet-24", volumeUsd: 25 });
    expect(result.wallets.current[0].preferredProducts[0]).toMatchObject({ key: "56::ape", token: "APE", volumeUsd: 25 });
  });

  it("reports stale and partial source quality independently of catalogue freshness", () => {
    const result = buildCommercialInsights([sale("a", "2026-05-01", 1)], {
      salesAsOf: "2026-10-05T00:00:00Z", catalogueAsOf: "2026-11-06T12:00:00Z",
      failedContracts: 2, warnings: ["Catalogue retry failed."], now: NOW
    });
    expect(result.month).toBe("2026-09");
    expect(result.quality).toMatchObject({ partial: true, stale: true, failedContracts: 2,
      salesAsOf: "2026-10-05T00:00:00Z", catalogueAsOf: "2026-11-06T12:00:00Z" });
    expect(result.quality.warnings).toHaveLength(3);
  });

  it("handles production-sized histories without spreading arrays onto the call stack", () => {
    const rows = Array.from({ length: 175_000 }, (_, index) => sale(`wallet-${index % 10000}`, "2026-10-02", 2));
    const result = build(rows);
    expect(result.summary).toMatchObject({ purchases: 175000, buyers: 10000, volumeUsd: 350000 });
    expect(result.wallets.current).toHaveLength(20);
    expect(result.observations.length).toBeLessThanOrEqual(3);
  });
});

function fakeClient(): ApeBondDataClient {
  return {
    getSalesInfo: vi.fn(async () => ({ bonds: [{ contractAddress: "0xape56", payoutToken: "APE", chainId: 56, soldOut: false }] })),
    getBondSales: vi.fn(async () => ({ Sales: [
      { ...sale("a", "2026-09-01", 50), chainId: 56, createdAddressOwner: "a", transactionHash: "0xsep" },
      { ...sale("a", "2026-10-01", 100), chainId: 56, createdAddressOwner: "a", transactionHash: "0xoct" }
    ] })),
    getPeriodSales: vi.fn(async () => ({})),
    getProjectSales: vi.fn(async () => ({})),
    getWalletSales: vi.fn(async () => ({}))
  };
}

describe("commercial insights API", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("serves cached history and independent catalogue metadata without rescanning bonds or wallets", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const client = fakeClient();
    const service = new DashboardService(client, { cachePath: null, requestDelayMs: 0 });
    await service.refreshAllTimeCache(true);
    const app = createServer(service);
    const response = await request(app).get("/api/commercial-insights?month=2026-10");
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ volumeUsd: 100, buyers: 1, returningBuyers: 1 });
    expect(response.body.comparisons.previous.volumeUsd).toBe(50);
    expect(response.body.products[0].catalogue.notSoldOut).toBe(1);
    expect(client.getBondSales).toHaveBeenCalledTimes(1);
    expect(client.getWalletSales).not.toHaveBeenCalled();
    expect(client.getPeriodSales).not.toHaveBeenCalled();
    expect(client.getSalesInfo).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for malformed/repeated months before beginning a historical build", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = fakeClient();
    const app = createServer(new DashboardService(client, { cachePath: null }));
    for (const query of ["month=2026-13", "month=2026-10&month=2026-09", "month=2026-11", "month=2027-01"]) {
      const response = await request(app).get(`/api/commercial-insights?${query}`);
      expect(response.status).toBe(400);
    }
    expect(client.getSalesInfo).not.toHaveBeenCalled();
  });

  it("returns 202 while the historical index is being constructed", async () => {
    const client = fakeClient();
    let resolveCatalogue: (value: Awaited<ReturnType<ApeBondDataClient["getSalesInfo"]>>) => void = () => {};
    client.getSalesInfo = vi.fn(() => new Promise<ApeBondSalesInfo>((resolve) => { resolveCatalogue = resolve; }));
    const service = new DashboardService(client, { cachePath: null, requestDelayMs: 0 });
    const response = await request(createServer(service)).get("/api/commercial-insights");
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: "building", progress: { status: "building" } });
    resolveCatalogue({ bonds: [] });
    await service.refreshAllTimeCache(true);
  });

  it("returns 503 rather than polling forever when the historical index failed", async () => {
    const client = fakeClient();
    vi.mocked(client.getSalesInfo).mockRejectedValue(new Error("Historical API unavailable"));
    const service = new DashboardService(client, { cachePath: null, requestDelayMs: 0 });
    await service.refreshAllTimeCache(true);
    const response = await request(createServer(service)).get("/api/commercial-insights");
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Historical API unavailable");
  });

  it("keeps historical insights available when the catalogue refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const client = fakeClient();
    const service = new DashboardService(client, { cachePath: null, requestDelayMs: 0, salesInfoCacheTtlMs: 0 });
    await service.refreshAllTimeCache(true);
    vi.mocked(client.getSalesInfo).mockRejectedValue(new Error("Catalogue unavailable"));
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    const response = await request(createServer(service)).get("/api/commercial-insights?month=2026-10");
    expect(response.status).toBe(200);
    expect(response.body.summary.volumeUsd).toBe(100);
    expect(response.body.quality.catalogueAsOf).toBe(NOW.toISOString());
    expect(response.body.quality.warnings).toContain("The latest catalogue request failed. Showing previously fetched catalogue metadata.");
  });
});
