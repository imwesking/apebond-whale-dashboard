import { derivePayoutToken, makePartnerKey } from "./partners.js";
import { getChainLabel } from "./tiers.js";
import type { ApeBondSale, NormalizedSale } from "./types.js";
import type {
  CommercialInsightsReadyResponse,
  CommercialPeriod,
  CommercialProduct,
  CommercialSummary,
  CommercialWalletRow
} from "./commercialInsightsTypes.js";

const DAY_MS = 86_400_000;
const WALLET_LIMIT = 20;

export interface CommercialInsightsOptions {
  month?: string;
  salesAsOf: string;
  catalogueAsOf: string | null;
  catalogueBonds?: ApeBondSale[];
  failedContracts?: number;
  warnings?: string[];
  now?: Date;
}

export function parseCommercialMonth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("Invalid month: use YYYY-MM for a completed UTC month");
  }
  return value;
}

function monthStart(month: string): number {
  return Date.parse(`${month}-01T00:00:00.000Z`) / 1000;
}

function monthKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 7);
}

function moveMonth(month: string, offset: number): string {
  const date = new Date(monthStart(month) * 1000);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function share(value: number, total: number): number | null {
  return total > 0 ? (value / total) * 100 : null;
}

function saleProduct(sale: NormalizedSale) {
  const token = sale.payoutToken?.trim() || derivePayoutToken({ lp: sale.lp });
  return { key: makePartnerKey(sale.chainId, token), token, chainId: sale.chainId };
}

interface MutableWallet {
  wallet: string;
  volumeUsd: number;
  purchases: number;
  lastBuyAt: number;
  months: Set<string>;
  maximumPurchaseUsd: number;
  products: Map<string, { key: string; token: string; chainId: number | null; volumeUsd: number }>;
}

function addWallet(map: Map<string, MutableWallet>, sale: NormalizedSale, month: string): void {
  let wallet = map.get(sale.wallet);
  if (!wallet) {
    wallet = {
      wallet: sale.wallet,
      volumeUsd: 0,
      purchases: 0,
      lastBuyAt: sale.createdAt,
      months: new Set(),
      maximumPurchaseUsd: Number.NEGATIVE_INFINITY,
      products: new Map()
    };
    map.set(sale.wallet, wallet);
  }
  wallet.volumeUsd += sale.dollarValue;
  wallet.purchases += 1;
  wallet.lastBuyAt = Math.max(wallet.lastBuyAt, sale.createdAt);
  wallet.months.add(month);
  wallet.maximumPurchaseUsd = Math.max(wallet.maximumPurchaseUsd, sale.dollarValue);
  const product = saleProduct(sale);
  const previous = wallet.products.get(product.key);
  if (previous) previous.volumeUsd += sale.dollarValue;
  else wallet.products.set(product.key, { ...product, volumeUsd: sale.dollarValue });
}

function walletRows(wallets: MutableWallet[]): CommercialWalletRow[] {
  return wallets
    .sort((a, b) => b.volumeUsd - a.volumeUsd || b.lastBuyAt - a.lastBuyAt || a.wallet.localeCompare(b.wallet))
    .slice(0, WALLET_LIMIT)
    .map((wallet) => ({
      wallet: wallet.wallet,
      volumeUsd: wallet.volumeUsd,
      purchases: wallet.purchases,
      lastBuyAt: wallet.lastBuyAt,
      activeMonths: wallet.months.size,
      preferredProducts: Array.from(wallet.products.values())
        .sort((a, b) => b.volumeUsd - a.volumeUsd || a.key.localeCompare(b.key))
        .slice(0, 3)
    }));
}

interface CatalogueContract {
  productKey: string;
  state: "soldOut" | "notSoldOut" | "unknown";
}

function contractKey(chainId: number | null, address: string): string {
  return `${chainId ?? "unknown"}::${address.toLowerCase()}`;
}

function buildCatalogue(bonds: ApeBondSale[]) {
  const contracts = new Map<string, CatalogueContract>();
  for (const bond of bonds) {
    const address = bond.contractAddress ?? bond.billAddress;
    if (!address) continue;
    const chainId = bond.chainId == null || !Number.isFinite(Number(bond.chainId)) ? null : Number(bond.chainId);
    const key = contractKey(chainId, address);
    const productKey = makePartnerKey(chainId, derivePayoutToken(bond));
    const state = bond.soldOut === true ? "soldOut" : bond.soldOut === false ? "notSoldOut" : "unknown";
    const existing = contracts.get(key);
    if (!existing) contracts.set(key, { productKey, state });
    else if (existing.state !== state || existing.productKey !== productKey) existing.state = "unknown";
  }
  const products = new Map<string, CommercialProduct["catalogue"]>();
  for (const contract of contracts.values()) {
    let counts = products.get(contract.productKey);
    if (!counts) {
      counts = { soldOut: 0, notSoldOut: 0, unknown: 0 };
      products.set(contract.productKey, counts);
    }
    counts[contract.state] += 1;
  }
  return { contracts, products };
}

/** Uses the existing historical index; no network or cache mutations occur here. */
export function buildCommercialInsights(
  sales: NormalizedSale[],
  options: CommercialInsightsOptions
): CommercialInsightsReadyResponse {
  const requestedMonth = parseCommercialMonth(options.month);
  const nowMs = (options.now ?? new Date()).getTime();
  const snapshotMs = Date.parse(options.salesAsOf);
  const validSnapshot = Number.isFinite(snapshotMs);
  const effectiveSnapshotMs = validSnapshot ? Math.min(snapshotMs, nowMs) : nowMs;
  const latestMonth = moveMonth(monthKey(effectiveSnapshotMs / 1000), -1);
  const firstBuy = new Map<string, number>();
  let firstObserved = Number.POSITIVE_INFINITY;
  for (const sale of sales) {
    if (sale.createdAt * 1000 > effectiveSnapshotMs) continue;
    firstObserved = Math.min(firstObserved, sale.createdAt);
    const first = firstBuy.get(sale.wallet);
    if (first === undefined || sale.createdAt < first) firstBuy.set(sale.wallet, sale.createdAt);
  }
  const firstMonth = Number.isFinite(firstObserved) ? [monthKey(firstObserved), latestMonth].sort()[0] : latestMonth;
  const availableMonths: string[] = [];
  for (let cursor = latestMonth; cursor >= firstMonth; cursor = moveMonth(cursor, -1)) availableMonths.push(cursor);
  const month = requestedMonth ?? latestMonth;
  if (month < firstMonth || month > latestMonth) {
    throw new Error("Invalid month: select a completed UTC month covered by the historical snapshot");
  }
  const periodFor = (key: string): CommercialPeriod => ({
    month: key,
    start: monthStart(key),
    end: monthStart(moveMonth(key, 1)),
    available: key >= firstMonth && key <= latestMonth
  });
  const period = periodFor(month);
  const previousPeriod = periodFor(moveMonth(month, -1));
  const yearAgoPeriod = periodFor(moveMonth(month, -12));
  const trendMonths = Array.from({ length: 6 }, (_, index) => moveMonth(month, index - 5));
  const relevantMonths = new Set([...trendMonths, previousPeriod.month, yearAgoPeriod.month]);
  const monthlySales = new Map<string, NormalizedSale[]>();
  const currentWallets = new Map<string, MutableWallet>();
  const previousWallets = new Map<string, MutableWallet>();
  const lookbackStart = monthStart(moveMonth(month, -12));
  for (const sale of sales) {
    if (sale.createdAt >= period.end || sale.createdAt * 1000 > effectiveSnapshotMs) continue;
    const key = monthKey(sale.createdAt);
    if (relevantMonths.has(key)) {
      const entries = monthlySales.get(key);
      if (entries) entries.push(sale);
      else monthlySales.set(key, [sale]);
    }
    if (sale.createdAt >= period.start) addWallet(currentWallets, sale, key);
    else if (sale.createdAt >= lookbackStart) addWallet(previousWallets, sale, key);
  }
  const summaries = new Map<string, CommercialSummary>();
  const summarize = (key: string): CommercialSummary => {
    const existing = summaries.get(key);
    if (existing) return existing;
    const rows = monthlySales.get(key) ?? [];
    const start = monthStart(key);
    const buyers = new Set<string>();
    const newBuyers = new Set<string>();
    let volumeUsd = 0;
    let newVolumeUsd = 0;
    for (const sale of rows) {
      buyers.add(sale.wallet);
      volumeUsd += sale.dollarValue;
      if ((firstBuy.get(sale.wallet) ?? sale.createdAt) >= start) {
        newBuyers.add(sale.wallet);
        newVolumeUsd += sale.dollarValue;
      }
    }
    const summary: CommercialSummary = {
      volumeUsd,
      buyers: buyers.size,
      purchases: rows.length,
      averagePurchaseUsd: rows.length > 0 ? volumeUsd / rows.length : null,
      medianPurchaseUsd: median(rows.map((sale) => sale.dollarValue)),
      newBuyers: newBuyers.size,
      returningBuyers: buyers.size - newBuyers.size,
      newVolumeUsd,
      returningVolumeUsd: volumeUsd - newVolumeUsd
    };
    summaries.set(key, summary);
    return summary;
  };
  const summary = summarize(month);
  const previousSummary = previousPeriod.available ? summarize(previousPeriod.month) : null;
  const yearAgoSummary = yearAgoPeriod.available ? summarize(yearAgoPeriod.month) : null;
  const catalogue = buildCatalogue(options.catalogueBonds ?? []);
  const mutableProducts = new Map<string, {
    key: string; token: string; chainId: number | null; volumeUsd: number; previousVolumeUsd: number;
    amounts: number[]; wallets: Map<string, number>; contracts: Set<string>;
  }>();
  for (const [key, isCurrent] of [[month, true], [previousPeriod.month, false]] as const) {
    for (const sale of monthlySales.get(key) ?? []) {
      const info = saleProduct(sale);
      let product = mutableProducts.get(info.key);
      if (!product) {
        product = { ...info, volumeUsd: 0, previousVolumeUsd: 0, amounts: [], wallets: new Map(), contracts: new Set() };
        mutableProducts.set(info.key, product);
      }
      product.contracts.add(contractKey(sale.chainId, sale.contractAddress));
      if (isCurrent) {
        product.volumeUsd += sale.dollarValue;
        product.amounts.push(sale.dollarValue);
        product.wallets.set(sale.wallet, (product.wallets.get(sale.wallet) ?? 0) + sale.dollarValue);
      } else product.previousVolumeUsd += sale.dollarValue;
    }
  }
  const products: CommercialProduct[] = Array.from(mutableProducts.values()).map((product) => {
    const counts = { ...(catalogue.products.get(product.key) ?? { soldOut: 0, notSoldOut: 0, unknown: 0 }) };
    for (const key of product.contracts) if (!catalogue.contracts.has(key)) counts.unknown += 1;
    let largestWallet = 0;
    for (const amount of product.wallets.values()) largestWallet = Math.max(largestWallet, amount);
    return {
      key: product.key,
      token: product.token,
      chainId: product.chainId,
      chainLabel: getChainLabel(product.chainId),
      volumeUsd: product.volumeUsd,
      previousVolumeUsd: previousSummary ? product.previousVolumeUsd : null,
      changeUsd: previousSummary ? product.volumeUsd - product.previousVolumeUsd : null,
      changePct: previousSummary && product.previousVolumeUsd > 0
        ? ((product.volumeUsd - product.previousVolumeUsd) / product.previousVolumeUsd) * 100 : null,
      buyers: product.wallets.size,
      purchases: product.amounts.length,
      medianPurchaseUsd: median(product.amounts),
      largestWalletSharePct: share(largestWallet, product.volumeUsd),
      catalogue: counts
    };
  }).sort((a, b) => b.volumeUsd - a.volumeUsd || a.key.localeCompare(b.key));
  const wallets = Array.from(currentWallets.values());
  const inactiveWallets = Array.from(previousWallets.values())
    .filter((wallet) => wallet.months.size >= 2 && !currentWallets.has(wallet.wallet));
  const rankedWallets = [...wallets].sort((a, b) => b.volumeUsd - a.volumeUsd);
  const walletShare = (count: number) => share(
    rankedWallets.slice(0, count).reduce((total, wallet) => total + wallet.volumeUsd, 0), summary.volumeUsd
  );
  const smallOnly = wallets.filter((wallet) => wallet.maximumPurchaseUsd < 10);
  const buyerSegments = {
    thresholds: [10, 100, 1000].map((minimumUsd) => ({
      minimumUsd, wallets: wallets.filter((wallet) => wallet.maximumPurchaseUsd >= minimumUsd).length
    })),
    smallOnly: { wallets: smallOnly.length, volumeUsd: smallOnly.reduce((sum, wallet) => sum + wallet.volumeUsd, 0) }
  };
  const concentration = {
    top1WalletPct: walletShare(1), top5WalletPct: walletShare(5), top10WalletPct: walletShare(10),
    top3ProductsPct: share(products.slice(0, 3).reduce((sum, product) => sum + product.volumeUsd, 0), summary.volumeUsd)
  };
  const warnings = [...(options.warnings ?? [])];
  const failedContracts = options.failedContracts ?? 0;
  const stale = validSnapshot && nowMs - snapshotMs > DAY_MS;
  if (failedContracts > 0) warnings.push(`The historical index has ${failedContracts} failed contract(s). Totals and buyer classifications may be incomplete.`);
  if (stale) warnings.push("The historical sales snapshot is more than 24 hours old.");
  if (!validSnapshot) warnings.push("The historical snapshot timestamp is unavailable. Period coverage cannot be verified.");
  const observations: string[] = [];
  if (previousSummary && previousSummary.volumeUsd > 0) {
    const changePct = ((summary.volumeUsd - previousSummary.volumeUsd) / previousSummary.volumeUsd) * 100;
    observations.push(`Bonded volume ${changePct >= 0 ? "increased" : "decreased"} ${Math.abs(changePct).toFixed(1)}% versus the previous completed month.`);
  }
  if (summary.buyers > 0) observations.push(`${smallOnly.length} of ${summary.buyers} buyer wallets only made purchases below $10.`);
  if (concentration.top3ProductsPct !== null) observations.push(`The three largest products accounted for ${concentration.top3ProductsPct.toFixed(1)}% of bonded volume.`);
  return {
    status: "ready", month, availableMonths, period, previousPeriod, yearAgoPeriod, summary,
    comparisons: { previous: previousSummary, yearAgo: yearAgoSummary },
    trend: trendMonths.map((key) => {
      const data = summarize(key);
      return { month: key, volumeUsd: data.volumeUsd, newVolumeUsd: data.newVolumeUsd,
        returningVolumeUsd: data.returningVolumeUsd, available: periodFor(key).available };
    }),
    products, buyerSegments, concentration,
    wallets: { current: walletRows(wallets), inactive: walletRows(inactiveWallets),
      totalCurrent: wallets.length, totalInactive: inactiveWallets.length, lookbackStart, lookbackEnd: period.start },
    observations: observations.slice(0, 3),
    quality: { salesAsOf: options.salesAsOf, catalogueAsOf: options.catalogueAsOf,
      failedContracts, partial: failedContracts > 0 || !validSnapshot, stale, warnings }
  };
}
