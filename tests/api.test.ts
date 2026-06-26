import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ApeBondDataClient } from "../server/apeBondClient";
import { DashboardService } from "../server/dashboardService";
import { createServer } from "../server/index";

const fakeClient: ApeBondDataClient = {
  async getSalesInfo() {
    return {
      bonds: [
        {
          lp: "USDC-ELON",
          payoutToken: "ELON",
          chainId: 56,
          contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          totalSales: 1,
          totalDollarValue: 125,
          lastPurchaseDate: { createdAt: 200 }
        },
        {
          lp: "USDC-QONE",
          payoutToken: "QONE",
          chainId: 999,
          contractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          totalSales: 1,
          totalDollarValue: 50,
          lastPurchaseDate: { createdAt: 100 }
        }
      ]
    };
  },
  async getBondSales(contractAddress: string) {
    if (contractAddress.includes("bbbb")) throw new Error("simulated failure");
    return {
      Sales: [
        {
          lp: "USDC-ELON",
          contractAddress,
          createdAddressOwner: "0x1111111111111111111111111111111111111111",
          createdAt: 200,
          dollarValue: 125,
          payout: 1,
          tier: 5,
          chainId: 56,
          transactionHash: "0xaaa"
        }
      ]
    };
  },
  async getPeriodSales() {
    return {
      Sales: [
        {
          lp: "USDC-QONE",
          contractAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
          createdAddressOwner: "0x2222222222222222222222222222222222222222",
          createdAt: 100,
          dollarValue: 50,
          payout: 1,
          tier: 2,
          chainId: 999,
          transactionHash: "0xbbb"
        }
      ],
      UniqueWallets: 1,
      TotalSales: 1,
      DollarValue: 50
    };
  },
  async getProjectSales(project: string) {
    return {
      Bonds: [
        {
          lp: `USDC-${project}`,
          payoutToken: project,
          contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chainId: 56,
          totalSales: 1,
          totalDollarValue: 125,
          lastPurchaseDate: { createdAt: 200 }
        }
      ],
      Sales: [
        {
          lp: `USDC-${project}`,
          payoutToken: project,
          contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          createdAddressOwner: "0x1111111111111111111111111111111111111111",
          createdAt: 200,
          dollarValue: 125,
          payout: 1,
          tier: 5,
          chainId: 56,
          transactionHash: "0xaaa"
        }
      ]
    };
  },
  async getWalletSales(wallet: string) {
    return {
      tier: 2,
      Sales: [
        {
          lp: "USDC-QONE",
          contractAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
          createdAddressOwner: wallet,
          createdAt: 100,
          dollarValue: 50,
          payout: 1,
          tier: 2,
          chainId: 999,
          transactionHash: "0xbbb"
        }
      ]
    };
  }
};

describe("API", () => {
  it("returns period whales with summary", async () => {
    const app = createServer(new DashboardService(fakeClient, { cachePath: null }));
    const response = await request(app).get("/api/whales?scope=this_month");
    expect(response.status).toBe(200);
    expect(response.body.summary.uniqueWallets).toBe(1);
    expect(response.body.summary.sourceUniqueWallets).toBe(1);
    expect(response.body.rows[0].tierLabel).toBe("Gold");
  });

  it("filters main whales by selected partners", async () => {
    const app = createServer(new DashboardService(fakeClient, { cachePath: null }));
    const included = await request(app).get("/api/whales?scope=this_month&partners=999::qone");
    expect(included.status).toBe(200);
    expect(included.body.summary.totalBuys).toBe(1);

    const excluded = await request(app).get("/api/whales?scope=this_month&partners=56::elon");
    expect(excluded.status).toBe(200);
    expect(excluded.body.summary.totalBuys).toBe(0);

    const none = await request(app).get("/api/whales?scope=this_month&partners=none");
    expect(none.status).toBe(200);
    expect(none.body.summary.uniqueWallets).toBe(0);
  });

  it("filters main whales by date range", async () => {
    const app = createServer(new DashboardService(fakeClient, { cachePath: null }));

    const included = await request(app).get("/api/whales?scope=this_month&dateFrom=1970-01-01&dateTo=1970-01-01");
    expect(included.status).toBe(200);
    expect(included.body.summary.totalBuys).toBe(1);
    expect(included.body.summary.uniqueWallets).toBe(1);

    const excluded = await request(app).get("/api/whales?scope=this_month&dateFrom=1970-01-02&dateTo=1970-01-02");
    expect(excluded.status).toBe(200);
    expect(excluded.body.summary.totalBuys).toBe(0);
    expect(excluded.body.summary.uniqueWallets).toBe(0);
  });

  it("builds all-time cache and tolerates partial bond failures", async () => {
    const app = createServer(new DashboardService(fakeClient, { cachePath: null, concurrency: 2, requestDelayMs: 0 }));
    const response = await request(app).get("/api/whales?scope=all&limit=10");
    expect([200, 202]).toContain(response.status);
  });

  it("keeps the existing all-time cache when a scheduled refresh fails", async () => {
    let failRefresh = false;
    const client: ApeBondDataClient = {
      ...fakeClient,
      async getSalesInfo() {
        return {
          bonds: [
            {
              lp: "USDC-ELON",
              payoutToken: "ELON",
              chainId: 56,
              contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              totalSales: 1,
              totalDollarValue: 125,
              lastPurchaseDate: { createdAt: 200 }
            }
          ]
        };
      },
      async getBondSales(contractAddress: string) {
        if (failRefresh) throw new Error("simulated scheduled refresh failure");
        return fakeClient.getBondSales(contractAddress);
      }
    };
    const service = new DashboardService(client, { cachePath: null, concurrency: 1, requestDelayMs: 0 });
    await service.refreshAllTimeCache(true);
    failRefresh = true;
    await service.refreshAllTimeCache(true);

    const app = createServer(service);
    const response = await request(app).get("/api/whales?scope=all&limit=10");

    expect(response.status).toBe(200);
    expect(response.body.summary.totalBuys).toBe(1);
    expect(response.body.rows[0].wallet).toBe("0x1111111111111111111111111111111111111111");
  });

  it("returns monthly acquisition from the all-time index", async () => {
    const client: ApeBondDataClient = {
      ...fakeClient,
      async getSalesInfo() {
        return {
          bonds: [
            {
              lp: "USDC-APE",
              payoutToken: "APE",
              chainId: 56,
              contractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              totalSales: 2,
              totalDollarValue: 150,
              lastPurchaseDate: { createdAt: unixDate("2026-02-12") }
            },
            {
              lp: "USDC-BANANA",
              payoutToken: "BANANA",
              chainId: 56,
              contractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              totalSales: 1,
              totalDollarValue: 200,
              lastPurchaseDate: { createdAt: unixDate("2026-02-14") }
            }
          ]
        };
      },
      async getBondSales(contractAddress: string) {
        if (contractAddress.includes("aaaa")) {
          return {
            Sales: [
              {
                lp: "USDC-APE",
                contractAddress,
                createdAddressOwner: "0x1111111111111111111111111111111111111111",
                createdAt: unixDate("2026-01-10"),
                dollarValue: 100,
                payout: 1,
                tier: 2,
                chainId: 56,
                transactionHash: "0xjan"
              },
              {
                lp: "USDC-APE",
                contractAddress,
                createdAddressOwner: "0x1111111111111111111111111111111111111111",
                createdAt: unixDate("2026-02-12"),
                dollarValue: 50,
                payout: 1,
                tier: 2,
                chainId: 56,
                transactionHash: "0xfebrepeat"
              }
            ]
          };
        }

        return {
          Sales: [
            {
              lp: "USDC-BANANA",
              contractAddress,
              createdAddressOwner: "0x2222222222222222222222222222222222222222",
              createdAt: unixDate("2026-02-14"),
              dollarValue: 200,
              payout: 1,
              tier: 3,
              chainId: 56,
              transactionHash: "0xfebnew"
            }
          ]
        };
      }
    };
    const service = new DashboardService(client, { cachePath: null, concurrency: 2, requestDelayMs: 0 });
    await service.refreshAllTimeCache(true);

    const response = await request(createServer(service)).get("/api/acquisition/monthly");

    expect(response.status).toBe(200);
    expect(response.body.rows.map((row: { month: string }) => row.month)).toEqual(["2026-01", "2026-02"]);
    expect(response.body.summary.latestMonth.month).toBe("2026-02");
    expect(response.body.summary.latestMonth.firstTimeBuyerVolumeUsd).toBe(200);
    expect(response.body.summary.latestMonth.repeatBuyerVolumeUsd).toBe(50);
    expect(response.body.summary.latestMonth.firstTimeBuyerVolumeSharePct).toBe(80);
  });

  it("returns wallet detail", async () => {
    const app = createServer(new DashboardService(fakeClient, { cachePath: null }));
    const response = await request(app).get("/api/wallet/0x2222222222222222222222222222222222222222");
    expect(response.status).toBe(200);
    expect(response.body.summary.totalVolumeUsd).toBe(50);
    expect(response.body.summary.totalBonds).toBe(1);
  });

  it("returns partners, partner detail, and bond detail", async () => {
    const app = createServer(new DashboardService(fakeClient, { cachePath: null, concurrency: 2, requestDelayMs: 0 }));

    const partners = await request(app).get("/api/partners");
    expect(partners.status).toBe(200);
    expect(partners.body.totalRows).toBe(2);
    expect(partners.body.rows[0].token).toBe("ELON");

    const partner = await request(app).get("/api/partner/56/ELON");
    expect(partner.status).toBe(200);
    expect(partner.body.summary.uniqueWallets).toBe(1);
    expect(partner.body.bonds[0].contractAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const bond = await request(app).get("/api/bond/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(bond.status).toBe(200);
    expect(bond.body.summary.totalVolumeUsd).toBe(125);
    expect(bond.body.walletRows[0].wallet).toBe("0x1111111111111111111111111111111111111111");
  });
});

function unixDate(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00.000Z`) / 1000);
}
