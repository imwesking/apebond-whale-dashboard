import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateWhales,
  buildMonthlyAcquisition,
  buildMonthlyAcquisitionDetail,
  buildSummary,
  filterSales,
  isValidAcquisitionMonth,
  normalizeSales
} from "./aggregation.js";
import { ApeBondApiError, type ApeBondDataClient } from "./apeBondClient.js";
import {
  buildBondRow,
  buildBondRows,
  buildPartnerGroups,
  derivePayoutToken,
  findPartnerGroup,
  makePartnerKey,
  normalizeAddress
} from "./partners.js";
import type {
  AcquisitionMonthDetailReadyResponse,
  AcquisitionReadyResponse,
  AcquisitionSummary,
  ApeBondSale,
  ApeBondSalesInfo,
  BondDetailResponse,
  BuildingResponse,
  DashboardSummary,
  NormalizedSale,
  PartnerDetailResponse,
  PartnerListResponse,
  PeriodScope,
  ProgressState,
  Scope,
  WhaleQuery,
  WhaleResponse,
  WalletDetail
} from "./types.js";
import { VALID_PERIOD_SCOPES } from "./types.js";
import { getTierLabel } from "./tiers.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PERIOD_CACHE_TTL_MS = 5 * 60 * 1000;
const WALLET_CACHE_TTL_MS = 10 * 60 * 1000;
const SALES_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const PARTNER_CACHE_TTL_MS = 10 * 60 * 1000;
const BOND_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_REQUEST_DELAY_MS = 2500;
const CACHE_PATH = path.resolve(process.cwd(), ".cache", "all-time-sales.json");

interface DashboardServiceOptions {
  cachePath?: string | null;
  cacheTtlMs?: number;
  periodCacheTtlMs?: number;
  walletCacheTtlMs?: number;
  salesInfoCacheTtlMs?: number;
  partnerCacheTtlMs?: number;
  bondCacheTtlMs?: number;
  concurrency?: number;
  requestDelayMs?: number;
}

interface CachedAllTimeFile {
  builtAt: string;
  expiresAt: string;
  failures: string[];
  sales: NormalizedSale[];
}

interface AllTimeBuildResult {
  failures: string[];
  sales: NormalizedSale[];
}

interface AllTimeState {
  status: ProgressState["status"];
  sales: NormalizedSale[];
  failures: string[];
  builtAt?: number;
  expiresAt?: number;
  progress: ProgressState;
  promise?: Promise<void>;
}

interface CachedPeriod {
  expiresAt: number;
  sales: NormalizedSale[];
  source: { uniqueWallets?: number; totalSales?: number; dollarValue?: number; lastRefreshed?: string };
}

interface CachedWallet {
  expiresAt: number;
  detail: WalletDetail;
}

interface CachedSalesInfo {
  expiresAt: number;
  fetchedAt: string;
  data: ApeBondSalesInfo;
}

interface CachedPartner {
  expiresAt: number;
  detail: PartnerDetailResponse;
}

interface CachedBond {
  expiresAt: number;
  detail: BondDetailResponse;
}

export class BuildingError extends Error {
  constructor(public progress: ProgressState) {
    super("All-time cache is building");
  }
}

export class DashboardService {
  private readonly cachePath: string | null;
  private readonly cacheTtlMs: number;
  private readonly periodCacheTtlMs: number;
  private readonly walletCacheTtlMs: number;
  private readonly salesInfoCacheTtlMs: number;
  private readonly partnerCacheTtlMs: number;
  private readonly bondCacheTtlMs: number;
  private readonly concurrency: number;
  private readonly requestDelayMs: number;
  private readonly periodCache = new Map<PeriodScope, CachedPeriod>();
  private readonly walletCache = new Map<string, CachedWallet>();
  private readonly partnerCache = new Map<string, CachedPartner>();
  private readonly bondCache = new Map<string, CachedBond>();
  private salesInfoCache: CachedSalesInfo | null = null;

  private allTime: AllTimeState = {
    status: "empty",
    sales: [],
    failures: [],
    progress: {
      status: "empty",
      total: 0,
      completed: 0,
      failed: 0
    }
  };

  constructor(
    private readonly client: ApeBondDataClient,
    options: DashboardServiceOptions = {}
  ) {
    this.cachePath = options.cachePath === undefined ? CACHE_PATH : options.cachePath;
    this.cacheTtlMs = options.cacheTtlMs ?? (Number(process.env.ALL_TIME_CACHE_TTL_MS) || CACHE_TTL_MS);
    this.periodCacheTtlMs =
      options.periodCacheTtlMs ?? (Number(process.env.PERIOD_CACHE_TTL_MS) || PERIOD_CACHE_TTL_MS);
    this.walletCacheTtlMs =
      options.walletCacheTtlMs ?? (Number(process.env.WALLET_CACHE_TTL_MS) || WALLET_CACHE_TTL_MS);
    this.salesInfoCacheTtlMs =
      options.salesInfoCacheTtlMs ?? (Number(process.env.SALES_INFO_CACHE_TTL_MS) || SALES_INFO_CACHE_TTL_MS);
    this.partnerCacheTtlMs =
      options.partnerCacheTtlMs ?? (Number(process.env.PARTNER_CACHE_TTL_MS) || PARTNER_CACHE_TTL_MS);
    this.bondCacheTtlMs = options.bondCacheTtlMs ?? (Number(process.env.BOND_CACHE_TTL_MS) || BOND_CACHE_TTL_MS);
    this.concurrency = options.concurrency ?? (Number(process.env.ALL_TIME_CONCURRENCY) || DEFAULT_CONCURRENCY);
    this.requestDelayMs =
      options.requestDelayMs ?? (Number(process.env.ALL_TIME_REQUEST_DELAY_MS) || DEFAULT_REQUEST_DELAY_MS);
  }

  getProgress(): ProgressState {
    return { ...this.allTime.progress };
  }

  async refreshAllTimeCache(wait = false): Promise<void> {
    if (this.allTime.promise) {
      if (wait) await this.allTime.promise;
      return;
    }

    if (this.allTime.status === "empty") {
      await this.loadDiskCache();
    }

    this.startAllTimeBuild(this.allTime.status === "ready");
    if (wait && this.allTime.promise) {
      await this.allTime.promise;
    }
  }

  async getWhales(query: WhaleQuery, waitForAllTime = false): Promise<WhaleResponse | BuildingResponse> {
    const { sales, source } = await this.getSalesForScope(query.scope, waitForAllTime);
    const filtered = filterSales(sales, query);
    const whales = aggregateWhales(filtered, query.sort, query.secondarySort);
    const rows = whales.slice(query.offset, query.offset + query.limit);
    const summary = buildSummary(query.scope, filtered, whales, getSummarySource(source, query.partnerKeys));

    return {
      status: "ready",
      scope: query.scope,
      rows,
      totalRows: whales.length,
      summary,
      progress: query.scope === "all" ? this.getProgress() : undefined,
      warnings: query.scope === "all" ? this.allTime.failures : []
    };
  }

  async getSummary(scope: Scope, filters: Omit<WhaleQuery, "limit" | "offset" | "sort">): Promise<DashboardSummary> {
    const { sales, source } = await this.getSalesForScope(scope, false);
    const filtered = filterSales(sales, filters);
    const whales = aggregateWhales(filtered);
    return buildSummary(scope, filtered, whales, getSummarySource(source, filters.partnerKeys));
  }

  async getMonthlyAcquisition(): Promise<AcquisitionReadyResponse> {
    const { sales, source } = await this.getSalesForScope("all", false);
    const rows = buildMonthlyAcquisition(sales);

    return {
      status: "ready",
      rows,
      summary: buildAcquisitionSummary(sales, rows, source?.lastRefreshed),
      progress: this.getProgress(),
      warnings: this.allTime.failures
    };
  }

  async getMonthlyAcquisitionDetail(month: string): Promise<AcquisitionMonthDetailReadyResponse> {
    if (!isValidAcquisitionMonth(month)) {
      throw new Error(`Invalid acquisition month: ${month}`);
    }

    const { sales } = await this.getSalesForScope("all", false);
    const detail = buildMonthlyAcquisitionDetail(sales, month);

    return {
      status: "ready",
      month: detail.month,
      monthStart: detail.monthStart,
      summary: detail.summary,
      wallets: detail.wallets,
      totalWallets: detail.wallets.length,
      progress: this.getProgress(),
      warnings: this.allTime.failures
    };
  }

  async getWalletDetail(wallet: string): Promise<WalletDetail> {
    const normalizedWallet = wallet.toLowerCase();
    const cached = this.walletCache.get(normalizedWallet);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.detail;
    }

    const data = await this.client.getWalletSales(normalizedWallet);
    const sales = normalizeSales(data.Sales ?? []);
    const bonds = new Set(sales.map((sale) => sale.contractAddress));
    const latestSale = sales.reduce<NormalizedSale | null>(
      (latest, sale) => (!latest || sale.createdAt > latest.createdAt ? sale : latest),
      null
    );
    let firstBuyAt: number | null = null;
    let lastBuyAt: number | null = null;
    let totalVolumeUsd = 0;
    for (const sale of sales) {
      totalVolumeUsd += sale.dollarValue;
      if (firstBuyAt === null || sale.createdAt < firstBuyAt) firstBuyAt = sale.createdAt;
      if (lastBuyAt === null || sale.createdAt > lastBuyAt) lastBuyAt = sale.createdAt;
    }
    const tier = data.tier ?? latestSale?.tier ?? null;

    const detail: WalletDetail = {
      wallet: normalizedWallet,
      summary: {
        totalVolumeUsd,
        totalBuys: sales.length,
        totalBonds: bonds.size,
        firstBuyAt,
        lastBuyAt,
        tier,
        tierLabel: getTierLabel(tier)
      },
      sales
    };

    this.walletCache.set(normalizedWallet, {
      expiresAt: Date.now() + this.walletCacheTtlMs,
      detail
    });
    return detail;
  }

  async getPartners(): Promise<PartnerListResponse> {
    const { groups, fetchedAt } = await this.getPartnerGroups();
    let totalVolumeUsd = 0;
    let totalBuys = 0;
    let uniqueBonds = 0;

    const rows = groups.map((group) => {
      totalVolumeUsd += group.partner.totalVolumeUsd;
      totalBuys += group.partner.totalBuys;
      uniqueBonds += group.partner.totalBonds;
      return group.partner;
    });

    return {
      status: "ready",
      rows,
      totalRows: rows.length,
      summary: {
        partners: rows.length,
        totalVolumeUsd,
        totalBuys,
        uniqueBonds,
        lastRefreshed: fetchedAt
      }
    };
  }

  async getPartnerDetail(chainSegment: string, token: string): Promise<PartnerDetailResponse> {
    const { groups } = await this.getPartnerGroups();
    const group = findPartnerGroup(groups, chainSegment, token);
    if (!group) {
      throw new Error(`Invalid partner: ${chainSegment}/${token}`);
    }

    const cacheKey = group.partner.key;
    const cached = this.partnerCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.detail;
    }

    const data = await this.client.getProjectSales(group.partner.token);
    const rawBonds = (data.Bonds ?? []).filter((bond) => this.rawBondMatchesPartner(bond, group.contractSet, group.partner.key));
    const bonds = buildBondRows(rawBonds.length > 0 ? rawBonds : group.rawBonds);
    const rawSales = (data.Sales ?? []).filter((sale) => this.rawBondMatchesPartner(sale, group.contractSet, group.partner.key));
    const sales = normalizeSales(rawSales);
    const whales = aggregateWhales(sales, "volume_desc", "last_desc");
    const summary = buildSummary("all", sales, whales, { lastRefreshed: new Date().toISOString() });
    const soldOutBonds = bonds.filter((bond) => bond.soldOut).length;
    const topBond = bonds[0] ?? null;
    const partner = {
      ...group.partner,
      totalVolumeUsd: summary.totalVolumeUsd || group.partner.totalVolumeUsd,
      totalBuys: summary.totalBuys || group.partner.totalBuys,
      totalBonds: bonds.length,
      activeBonds: bonds.length - soldOutBonds,
      soldOutBonds,
      lastBuyAt: summary.lastBuyAt ?? group.partner.lastBuyAt,
      topBond
    };

    const detail: PartnerDetailResponse = {
      status: "ready",
      partner,
      bonds,
      walletRows: whales.slice(0, 100),
      totalWalletRows: whales.length,
      summary,
      warnings: rawSales.length === 0 ? ["Project sales endpoint returned no sales for this partner."] : []
    };

    this.partnerCache.set(cacheKey, {
      expiresAt: Date.now() + this.partnerCacheTtlMs,
      detail
    });
    return detail;
  }

  async getBondDetail(address: string): Promise<BondDetailResponse> {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) throw new Error(`Invalid bond address: ${address}`);

    const cached = this.bondCache.get(normalizedAddress);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.detail;
    }

    const { data: salesInfo } = await this.getCachedSalesInfo();
    const catalogBond = (salesInfo.bonds ?? []).find(
      (bond) => normalizeAddress(bond.contractAddress ?? bond.billAddress) === normalizedAddress
    );
    const data = await this.client.getBondSales(normalizedAddress);
    const rawSales = data.Sales ?? [];
    const sales = normalizeSales(rawSales);
    const whales = aggregateWhales(sales, "volume_desc", "last_desc");
    const summary = buildSummary("all", sales, whales, { lastRefreshed: new Date().toISOString() });
    const latestSale = rawSales.reduce<ApeBondSale | null>(
      (latest, sale) => (!latest || Number(sale.createdAt) > Number(latest.createdAt) ? sale : latest),
      null
    );

    const rawBond: ApeBondSale = {
      ...(catalogBond ?? latestSale ?? {}),
      contractAddress: normalizedAddress,
      totalDollarValue: data.totalDollarValue ?? catalogBond?.totalDollarValue ?? summary.totalVolumeUsd,
      totalSales: sales.length || catalogBond?.totalSales || 0,
      percentageSold: data.percentageSold ?? catalogBond?.percentageSold,
      lastPurchaseDate: latestSale ?? catalogBond?.lastPurchaseDate
    };

    const detail: BondDetailResponse = {
      status: "ready",
      bond: buildBondRow(rawBond),
      walletRows: whales.slice(0, 100),
      totalWalletRows: whales.length,
      summary,
      sales,
      warnings: rawSales.length === 0 ? ["Bond endpoint returned no sales for this contract."] : []
    };

    this.bondCache.set(normalizedAddress, {
      expiresAt: Date.now() + this.bondCacheTtlMs,
      detail
    });
    return detail;
  }

  private async getSalesForScope(
    scope: Scope,
    waitForAllTime = false
  ): Promise<{
    sales: NormalizedSale[];
    source?: { uniqueWallets?: number; totalSales?: number; dollarValue?: number; lastRefreshed?: string };
  }> {
    if (scope === "all") {
      await this.ensureAllTimeCache(false, waitForAllTime);
      if (this.allTime.status !== "ready") {
        throw new BuildingError(this.getProgress());
      }
      return {
        sales: this.allTime.sales,
        source: {
          lastRefreshed:
            this.allTime.progress.builtAt ??
            (this.allTime.builtAt ? new Date(this.allTime.builtAt).toISOString() : undefined)
        }
      };
    }

    if (!VALID_PERIOD_SCOPES.includes(scope as PeriodScope)) {
      throw new Error(`Unsupported scope: ${scope}`);
    }

    const periodScope = scope as PeriodScope;
    const cached = this.periodCache.get(periodScope);
    if (cached && cached.expiresAt > Date.now()) {
      return { sales: cached.sales, source: cached.source };
    }

    const data = await this.client.getPeriodSales(scope as PeriodScope);
    const result = {
      sales: normalizeSales(data.Sales ?? []),
      source: {
        uniqueWallets: data.UniqueWallets,
        totalSales: data.TotalSales,
        dollarValue: data.DollarValue,
        lastRefreshed: new Date().toISOString()
      }
    };

    this.periodCache.set(periodScope, {
      expiresAt: Date.now() + this.periodCacheTtlMs,
      ...result
    });

    return result;
  }

  private async ensureAllTimeCache(forceRefresh = false, wait = false): Promise<void> {
    if (!forceRefresh && this.allTime.status === "ready") {
      return;
    }

    if (!forceRefresh && this.allTime.status === "empty") {
      const loaded = await this.loadDiskCache();
      if (loaded) return;
    }

    if (!forceRefresh && this.allTime.status === "error") {
      return;
    }

    if (this.allTime.status === "building" && this.allTime.promise) {
      if (wait) await this.allTime.promise;
      return;
    }

    this.startAllTimeBuild();
    if (wait && this.allTime.promise) {
      await this.allTime.promise;
    }
  }

  private startAllTimeBuild(preserveReadyCache = false): void {
    const startedAt = new Date().toISOString();
    this.allTime.status = preserveReadyCache ? "ready" : "building";
    if (!preserveReadyCache) {
      this.allTime.sales = [];
      this.allTime.failures = [];
      this.allTime.builtAt = undefined;
      this.allTime.expiresAt = undefined;
    }
    this.allTime.progress = {
      status: "building",
      total: 0,
      completed: 0,
      failed: 0,
      startedAt,
      updatedAt: startedAt
    };

    let buildPromise: Promise<void>;
    buildPromise = this.buildAllTimeCache()
      .then(async (result) => {
        const builtAt = Date.now();
        await this.writeDiskCache(result.sales, result.failures);
        this.allTime.sales = result.sales;
        this.allTime.failures = result.failures;
        this.allTime.status = "ready";
        this.allTime.builtAt = builtAt;
        this.allTime.expiresAt = builtAt + this.cacheTtlMs;
        this.allTime.progress = {
          ...this.allTime.progress,
          status: "ready",
          builtAt: new Date(builtAt).toISOString(),
          expiresAt: new Date(builtAt + this.cacheTtlMs).toISOString(),
          updatedAt: new Date().toISOString()
        };
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.allTime.status = preserveReadyCache ? "ready" : "error";
        this.allTime.progress = {
          ...this.allTime.progress,
          status: preserveReadyCache ? "ready" : "error",
          error: message,
          builtAt: preserveReadyCache && this.allTime.builtAt ? new Date(this.allTime.builtAt).toISOString() : undefined,
          expiresAt:
            preserveReadyCache && this.allTime.expiresAt ? new Date(this.allTime.expiresAt).toISOString() : undefined,
          updatedAt: new Date().toISOString()
        };
      })
      .finally(() => {
        if (this.allTime.promise === buildPromise) {
          this.allTime.promise = undefined;
        }
      });
    this.allTime.promise = buildPromise;
  }

  private async buildAllTimeCache(): Promise<AllTimeBuildResult> {
    const { data: salesInfo } = await this.getCachedSalesInfo();
    const contractMap = new Map<string, string>();
    for (const bond of salesInfo.bonds ?? []) {
      if (!bond.contractAddress) continue;
      const key = bond.contractAddress.toLowerCase();
      if (!contractMap.has(key)) contractMap.set(key, bond.contractAddress);
    }
    const contracts = Array.from(contractMap.values());

    this.allTime.progress = {
      ...this.allTime.progress,
      total: contracts.length,
      updatedAt: new Date().toISOString()
    };

    const rawSales: ApeBondSale[] = [];
    const failures: string[] = [];
    const concurrency = this.concurrency;
    let cursor = 0;

    const worker = async () => {
      while (cursor < contracts.length) {
        const contract = contracts[cursor++];
        this.allTime.progress = {
          ...this.allTime.progress,
          current: contract,
          updatedAt: new Date().toISOString()
        };

        try {
          const result = await this.getBondSalesWithRetry(contract);
          rawSales.push(...(result.Sales ?? []));
        } catch {
          failures.push(contract);
          this.allTime.progress.failed += 1;
        } finally {
          this.allTime.progress.completed += 1;
          this.allTime.progress.updatedAt = new Date().toISOString();
          if (this.requestDelayMs > 0) await delay(this.requestDelayMs);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, contracts.length) }, worker));
    const failureRatio = contracts.length > 0 ? failures.length / contracts.length : 0;
    if (failureRatio > 0.5) {
      throw new Error(
        `All-time build failed for ${failures.length}/${contracts.length} bonds. Try refresh again after the ApeBond API rate limit cools down.`
      );
    }

    return {
      failures,
      sales: normalizeSales(rawSales)
    };
  }

  private async getPartnerGroups() {
    const { data, fetchedAt } = await this.getCachedSalesInfo();
    return {
      groups: buildPartnerGroups(data.bonds ?? []),
      fetchedAt
    };
  }

  private async getCachedSalesInfo(): Promise<{ data: ApeBondSalesInfo; fetchedAt: string }> {
    if (this.salesInfoCache && this.salesInfoCache.expiresAt > Date.now()) {
      return { data: this.salesInfoCache.data, fetchedAt: this.salesInfoCache.fetchedAt };
    }

    const fetchedAt = new Date().toISOString();
    const data = await this.client.getSalesInfo();
    this.salesInfoCache = {
      expiresAt: Date.now() + this.salesInfoCacheTtlMs,
      fetchedAt,
      data
    };
    return { data, fetchedAt };
  }

  private rawBondMatchesPartner(rawBond: ApeBondSale, contractSet: Set<string>, partnerKey: string): boolean {
    const contractAddress = normalizeAddress(rawBond.contractAddress ?? rawBond.billAddress);
    if (contractAddress && contractSet.has(contractAddress)) return true;
    const chainId = rawBond.chainId === undefined || rawBond.chainId === null ? null : Number(rawBond.chainId);
    return makePartnerKey(Number.isFinite(chainId) ? chainId : null, derivePayoutToken(rawBond)) === partnerKey;
  }

  private async getBondSalesWithRetry(contract: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.getBondSales(contract);
      } catch (error) {
        lastError = error;
        const rateLimited = error instanceof ApeBondApiError && error.status === 429;
        await delay(rateLimited ? 10_000 * (attempt + 1) : 800 * (attempt + 1));
      }
    }
    throw lastError;
  }

  private async loadDiskCache(): Promise<boolean> {
    if (!this.cachePath) return false;

    try {
      const raw = await readFile(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as CachedAllTimeFile;
      const expiresAt = Date.parse(parsed.expiresAt);
      if (!Array.isArray(parsed.sales) || !Number.isFinite(expiresAt)) {
        return false;
      }

      this.allTime = {
        status: "ready",
        sales: parsed.sales,
        failures: parsed.failures ?? [],
        builtAt: Date.parse(parsed.builtAt),
        expiresAt,
        progress: {
          status: "ready",
          total: 0,
          completed: 0,
          failed: parsed.failures?.length ?? 0,
          builtAt: parsed.builtAt,
          expiresAt: parsed.expiresAt,
          updatedAt: new Date().toISOString()
        }
      };
      return true;
    } catch {
      return false;
    }
  }

  private async writeDiskCache(sales = this.allTime.sales, failures = this.allTime.failures): Promise<void> {
    if (!this.cachePath) return;

    const builtAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.cacheTtlMs).toISOString();
    const payload: CachedAllTimeFile = {
      builtAt,
      expiresAt,
      failures,
      sales
    };

    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(payload), "utf8");
  }
}

function buildAcquisitionSummary(
  sales: NormalizedSale[],
  rows: AcquisitionReadyResponse["rows"],
  lastRefreshed?: string
): AcquisitionSummary {
  let totalVolumeUsd = 0;
  let firstTimeBuyerVolumeUsd = 0;
  let repeatBuyerVolumeUsd = 0;
  let peakFirstTimeBuyerMonth: AcquisitionReadyResponse["rows"][number] | null = null;
  const uniqueBuyers = new Set<string>();

  for (const sale of sales) {
    uniqueBuyers.add(sale.wallet);
  }

  for (const row of rows) {
    totalVolumeUsd += row.totalVolumeUsd;
    firstTimeBuyerVolumeUsd += row.firstTimeBuyerVolumeUsd;
    repeatBuyerVolumeUsd += row.repeatBuyerVolumeUsd;
    if (
      row.firstTimeBuyerVolumeUsd > 0 &&
      (!peakFirstTimeBuyerMonth || row.firstTimeBuyerVolumeUsd > peakFirstTimeBuyerMonth.firstTimeBuyerVolumeUsd)
    ) {
      peakFirstTimeBuyerMonth = row;
    }
  }

  return {
    months: rows.length,
    totalVolumeUsd,
    firstTimeBuyerVolumeUsd,
    repeatBuyerVolumeUsd,
    firstTimeBuyerVolumeSharePct: totalVolumeUsd > 0 ? (firstTimeBuyerVolumeUsd / totalVolumeUsd) * 100 : 0,
    uniqueBuyers: uniqueBuyers.size,
    latestMonth: rows.at(-1) ?? null,
    peakFirstTimeBuyerMonth,
    lastRefreshed: lastRefreshed ?? new Date().toISOString()
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSummarySource(
  source: { uniqueWallets?: number; totalSales?: number; dollarValue?: number; lastRefreshed?: string } | undefined,
  partnerKeys: string[] | undefined
) {
  if (!source || partnerKeys === undefined) return source;
  return { lastRefreshed: source.lastRefreshed };
}
