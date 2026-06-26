import { getChainLabel, getTierLabel } from "./tiers.js";
import { derivePayoutToken, makePartnerKey } from "./partners.js";
import type {
  AcquisitionBuyerType,
  AcquisitionMonthRow,
  AcquisitionWalletRow,
  ApeBondSale,
  DashboardSummary,
  NormalizedSale,
  Scope,
  SortKey,
  WhaleWallet
} from "./types.js";

export const LOW_VALUE_USD = 10;

const SORT_FIELDS: Record<SortKey, string> = {
  volume_desc: "volume",
  volume_asc: "volume",
  buys_desc: "buys",
  buys_asc: "buys",
  bonds_desc: "bonds",
  bonds_asc: "bonds",
  last_desc: "last",
  last_asc: "last",
  last_buy_usd_desc: "last_buy_usd",
  last_buy_usd_asc: "last_buy_usd",
  tier_desc: "tier",
  tier_asc: "tier",
  chains_desc: "chains",
  chains_asc: "chains",
  wallet_asc: "wallet",
  wallet_desc: "wallet"
};

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAddress(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function normalizeSale(raw: ApeBondSale): NormalizedSale | null {
  const wallet = normalizeAddress(raw.createdAddressOwner);
  const contractAddress = normalizeAddress(raw.contractAddress);
  const createdAt = asNumber(raw.createdAt);
  const dollarValue = asNumber(raw.dollarValue);

  if (!wallet || !contractAddress || !createdAt || !Number.isFinite(dollarValue)) {
    return null;
  }

  const transactionHash =
    typeof raw.transactionHash === "string" && raw.transactionHash.length > 0
      ? raw.transactionHash.toLowerCase()
      : null;
  const chainId = raw.chainId === undefined || raw.chainId === null ? null : asNumber(raw.chainId, NaN);
  const tier = raw.tier === undefined || raw.tier === null ? null : asNumber(raw.tier, NaN);
  const safeTier = tier === null || Number.isNaN(tier) ? null : tier;
  const safeChainId = chainId === null || Number.isNaN(chainId) ? null : chainId;

  const key = transactionHash
    ? `${safeChainId ?? "x"}:${transactionHash}`
    : `${safeChainId ?? "x"}:${contractAddress}:${wallet}:${createdAt}:${dollarValue.toFixed(8)}`;

  return {
    key,
    lp: raw.lp || raw.payoutToken || "Bond",
    contractAddress,
    wallet,
    createdAt,
    dollarValue,
    payout: asNumber(raw.payout),
    payoutTokenPrice: asNumber(raw.payoutTokenPrice),
    tier: safeTier,
    chainId: safeChainId,
    transactionHash,
    payoutToken: derivePayoutToken(raw)
  };
}

export function normalizeSales(rawSales: ApeBondSale[] = []): NormalizedSale[] {
  const byKey = new Map<string, NormalizedSale>();

  for (const raw of rawSales) {
    const sale = normalizeSale(raw);
    if (!sale) continue;
    byKey.set(sale.key, sale);
  }

  return Array.from(byKey.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export interface SaleFilters {
  chainId?: number;
  partnerKeys?: string[];
  tier?: number | "none";
  q?: string;
  dateFrom?: number;
  dateTo?: number;
  hideLowValue?: boolean;
}

export function filterSales(sales: NormalizedSale[], filters: SaleFilters): NormalizedSale[] {
  const query = filters.q?.trim().toLowerCase();
  const partnerSet = filters.partnerKeys ? new Set(filters.partnerKeys) : null;

  return sales.filter((sale) => {
    if (partnerSet && !partnerSet.has(getSalePartnerKey(sale))) return false;
    if (filters.chainId !== undefined && sale.chainId !== filters.chainId) return false;
    if (filters.tier === "none" && sale.tier !== null) return false;
    if (typeof filters.tier === "number" && sale.tier !== filters.tier) return false;
    if (filters.dateFrom !== undefined && sale.createdAt < filters.dateFrom) return false;
    if (filters.dateTo !== undefined && sale.createdAt > filters.dateTo) return false;
    if (filters.hideLowValue && sale.dollarValue < LOW_VALUE_USD) return false;
    if (query && !sale.wallet.includes(query)) return false;
    return true;
  });
}

function getSalePartnerKey(sale: NormalizedSale): string {
  return makePartnerKey(sale.chainId, sale.payoutToken || derivePayoutToken({ lp: sale.lp }));
}

interface MutableWallet {
  wallet: string;
  totalVolumeUsd: number;
  totalBuys: number;
  bonds: Set<string>;
  chains: Set<number>;
  lastBuyAt: number;
  lastBuyUsd: number;
  tier: number | null;
}

export function aggregateWhales(
  sales: NormalizedSale[],
  sort: SortKey = "volume_desc",
  secondarySort?: SortKey
): WhaleWallet[] {
  const wallets = new Map<string, MutableWallet>();

  for (const sale of sales) {
    const current =
      wallets.get(sale.wallet) ??
      ({
        wallet: sale.wallet,
        totalVolumeUsd: 0,
        totalBuys: 0,
        bonds: new Set<string>(),
        chains: new Set<number>(),
        lastBuyAt: 0,
        lastBuyUsd: 0,
        tier: null
      } satisfies MutableWallet);

    current.totalVolumeUsd += sale.dollarValue;
    current.totalBuys += 1;
    current.bonds.add(sale.contractAddress);
    if (sale.chainId !== null) current.chains.add(sale.chainId);
    if (sale.createdAt > current.lastBuyAt) {
      current.lastBuyAt = sale.createdAt;
      current.lastBuyUsd = sale.dollarValue;
      current.tier = sale.tier ?? current.tier;
    }

    wallets.set(sale.wallet, current);
  }

  const rows = Array.from(wallets.values()).map((wallet) => {
    const chains = Array.from(wallet.chains).sort((a, b) => a - b);
    return {
      rank: 0,
      wallet: wallet.wallet,
      totalVolumeUsd: wallet.totalVolumeUsd,
      totalBuys: wallet.totalBuys,
      totalBonds: wallet.bonds.size,
      lastBuyAt: wallet.lastBuyAt,
      lastBuyUsd: wallet.lastBuyUsd,
      tier: wallet.tier,
      tierLabel: getTierLabel(wallet.tier),
      chains,
      chainLabels: chains.map(getChainLabel)
    };
  });

  rows.sort(makeWhaleComparator(sort, secondarySort));

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function makeWhaleComparator(primary: SortKey, secondary?: SortKey) {
  const sorts: SortKey[] = [];
  for (const candidate of [primary, secondary, "volume_desc", "last_desc", "wallet_asc"] as Array<SortKey | undefined>) {
    if (candidate && !sorts.includes(candidate) && !sorts.some((sort) => SORT_FIELDS[sort] === SORT_FIELDS[candidate])) {
      sorts.push(candidate);
    }
  }

  return (a: WhaleWallet, b: WhaleWallet) => {
    for (const sort of sorts) {
      const result = compareWhales(a, b, sort);
      if (result !== 0) return result;
    }
    return 0;
  };
}

function compareWhales(a: WhaleWallet, b: WhaleWallet, sort: SortKey): number {
  switch (sort) {
    case "volume_asc":
      return a.totalVolumeUsd - b.totalVolumeUsd;
    case "volume_desc":
      return b.totalVolumeUsd - a.totalVolumeUsd;
    case "buys_asc":
      return a.totalBuys - b.totalBuys;
    case "buys_desc":
      return b.totalBuys - a.totalBuys;
    case "bonds_asc":
      return a.totalBonds - b.totalBonds;
    case "bonds_desc":
      return b.totalBonds - a.totalBonds;
    case "last_asc":
      return a.lastBuyAt - b.lastBuyAt;
    case "last_desc":
      return b.lastBuyAt - a.lastBuyAt;
    case "last_buy_usd_asc":
      return a.lastBuyUsd - b.lastBuyUsd;
    case "last_buy_usd_desc":
      return b.lastBuyUsd - a.lastBuyUsd;
    case "tier_asc":
      return compareTiers(a.tier, b.tier, "asc");
    case "tier_desc":
      return compareTiers(a.tier, b.tier, "desc");
    case "chains_asc":
      return a.chains.length - b.chains.length;
    case "chains_desc":
      return b.chains.length - a.chains.length;
    case "wallet_desc":
      return b.wallet.localeCompare(a.wallet);
    case "wallet_asc":
      return a.wallet.localeCompare(b.wallet);
    default:
      return 0;
  }
}

function compareTiers(a: number | null, b: number | null, direction: "asc" | "desc"): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

export function buildSummary(
  scope: Scope,
  sales: NormalizedSale[],
  whales: WhaleWallet[],
  source?: { uniqueWallets?: number; totalSales?: number; dollarValue?: number; lastRefreshed?: string }
): DashboardSummary {
  const uniqueBonds = new Set<string>();
  let lastBuyAt: number | null = null;
  let totalVolumeUsd = 0;

  const chainMap = new Map<number, { chainId: number; label: string; totalVolumeUsd: number; totalBuys: number }>();
  for (const sale of sales) {
    uniqueBonds.add(sale.contractAddress);
    totalVolumeUsd += sale.dollarValue;
    if (lastBuyAt === null || sale.createdAt > lastBuyAt) lastBuyAt = sale.createdAt;

    if (sale.chainId === null) continue;
    const current =
      chainMap.get(sale.chainId) ??
      ({ chainId: sale.chainId, label: getChainLabel(sale.chainId), totalVolumeUsd: 0, totalBuys: 0 });
    current.totalVolumeUsd += sale.dollarValue;
    current.totalBuys += 1;
    chainMap.set(sale.chainId, current);
  }

  const tierMap = new Map<string, { tier: number | null; label: string; wallets: number; totalVolumeUsd: number }>();
  for (const whale of whales) {
    const key = whale.tier === null ? "none" : String(whale.tier);
    const current =
      tierMap.get(key) ??
      ({ tier: whale.tier, label: whale.tierLabel, wallets: 0, totalVolumeUsd: 0 });
    current.wallets += 1;
    current.totalVolumeUsd += whale.totalVolumeUsd;
    tierMap.set(key, current);
  }

  const topWallets = [...whales].sort(makeWhaleComparator("volume_desc", "last_desc")).slice(0, 10);

  return {
    scope,
    uniqueWallets: whales.length,
    totalVolumeUsd,
    totalBuys: sales.length,
    uniqueBonds: uniqueBonds.size,
    lastBuyAt,
    lastRefreshed: source?.lastRefreshed ?? new Date().toISOString(),
    chainMix: Array.from(chainMap.values()).sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd),
    tierMix: Array.from(tierMap.values()).sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd),
    topWallets,
    sourceUniqueWallets: source?.uniqueWallets,
    sourceTotalSales: source?.totalSales,
    sourceDollarValue: source?.dollarValue
  };
}

interface MutableAcquisitionMonth {
  month: string;
  monthStart: number;
  totalVolumeUsd: number;
  firstTimeBuyerVolumeUsd: number;
  repeatBuyerVolumeUsd: number;
  totalBuyers: Set<string>;
  firstTimeBuyers: Set<string>;
  repeatBuyers: Set<string>;
  totalBuys: number;
  firstTimeBuys: number;
  repeatBuys: number;
}

interface WalletFirstBuy {
  createdAt: number;
  month: string;
}

interface MutableAcquisitionWallet {
  wallet: string;
  buyerType: AcquisitionBuyerType;
  firstBuyAt: number;
  monthVolumeUsd: number;
  monthBuys: number;
  bonds: Set<string>;
  chains: Set<number>;
  lastBuyAt: number;
  lastBuyUsd: number;
  tier: number | null;
  purchases: NormalizedSale[];
}

export function buildMonthlyAcquisition(sales: NormalizedSale[]): AcquisitionMonthRow[] {
  if (sales.length === 0) return [];

  const firstBuyByWallet = getFirstBuyByWallet(sales);

  const months = new Map<string, MutableAcquisitionMonth>();
  let minMonthStart = Number.POSITIVE_INFINITY;
  let maxMonthStart = 0;

  for (const sale of sales) {
    const month = getUtcMonthKey(sale.createdAt);
    const monthStart = getUtcMonthStart(sale.createdAt);
    minMonthStart = Math.min(minMonthStart, monthStart);
    maxMonthStart = Math.max(maxMonthStart, monthStart);

    const current = getMutableAcquisitionMonth(months, month, monthStart);
    const isFirstTimeBuyerMonth = firstBuyByWallet.get(sale.wallet)?.month === month;

    current.totalVolumeUsd += sale.dollarValue;
    current.totalBuyers.add(sale.wallet);
    current.totalBuys += 1;

    if (isFirstTimeBuyerMonth) {
      current.firstTimeBuyerVolumeUsd += sale.dollarValue;
      current.firstTimeBuyers.add(sale.wallet);
      current.firstTimeBuys += 1;
    } else {
      current.repeatBuyerVolumeUsd += sale.dollarValue;
      current.repeatBuyers.add(sale.wallet);
      current.repeatBuys += 1;
    }
  }

  const rows: AcquisitionMonthRow[] = [];
  for (let cursor = minMonthStart; cursor <= maxMonthStart; cursor = addUtcMonth(cursor)) {
    const month = getUtcMonthKey(cursor);
    const current = getMutableAcquisitionMonth(months, month, cursor);
    rows.push(toAcquisitionMonthRow(current));
  }

  return rows;
}

export function buildMonthlyAcquisitionDetail(sales: NormalizedSale[], requestedMonth: string) {
  const firstBuyByWallet = getFirstBuyByWallet(sales);
  const monthStart = getMonthStartFromKey(requestedMonth);
  const month = getUtcMonthKey(monthStart);
  const wallets = new Map<string, MutableAcquisitionWallet>();
  const summary = getMutableAcquisitionMonth(new Map<string, MutableAcquisitionMonth>(), month, monthStart);

  for (const sale of sales) {
    if (getUtcMonthKey(sale.createdAt) !== month) continue;

    const firstBuy = firstBuyByWallet.get(sale.wallet);
    const buyerType: AcquisitionBuyerType = firstBuy?.month === month ? "first_time" : "repeat";
    const current =
      wallets.get(sale.wallet) ??
      ({
        wallet: sale.wallet,
        buyerType,
        firstBuyAt: firstBuy?.createdAt ?? sale.createdAt,
        monthVolumeUsd: 0,
        monthBuys: 0,
        bonds: new Set<string>(),
        chains: new Set<number>(),
        lastBuyAt: 0,
        lastBuyUsd: 0,
        tier: null,
        purchases: []
      } satisfies MutableAcquisitionWallet);

    current.monthVolumeUsd += sale.dollarValue;
    current.monthBuys += 1;
    current.bonds.add(sale.contractAddress);
    if (sale.chainId !== null) current.chains.add(sale.chainId);
    if (sale.createdAt > current.lastBuyAt) {
      current.lastBuyAt = sale.createdAt;
      current.lastBuyUsd = sale.dollarValue;
      current.tier = sale.tier ?? current.tier;
    }
    current.purchases.push(sale);
    wallets.set(sale.wallet, current);

    summary.totalVolumeUsd += sale.dollarValue;
    summary.totalBuyers.add(sale.wallet);
    summary.totalBuys += 1;
    if (buyerType === "first_time") {
      summary.firstTimeBuyerVolumeUsd += sale.dollarValue;
      summary.firstTimeBuyers.add(sale.wallet);
      summary.firstTimeBuys += 1;
    } else {
      summary.repeatBuyerVolumeUsd += sale.dollarValue;
      summary.repeatBuyers.add(sale.wallet);
      summary.repeatBuys += 1;
    }
  }

  const rows: AcquisitionWalletRow[] = Array.from(wallets.values())
    .map((wallet) => {
      const chains = Array.from(wallet.chains).sort((a, b) => a - b);
      const purchases = [...wallet.purchases].sort((a, b) => b.createdAt - a.createdAt || b.dollarValue - a.dollarValue);

      return {
        wallet: wallet.wallet,
        buyerType: wallet.buyerType,
        firstBuyAt: wallet.firstBuyAt,
        monthVolumeUsd: wallet.monthVolumeUsd,
        monthBuys: wallet.monthBuys,
        monthBonds: wallet.bonds.size,
        lastBuyAt: wallet.lastBuyAt,
        lastBuyUsd: wallet.lastBuyUsd,
        tier: wallet.tier,
        tierLabel: getTierLabel(wallet.tier),
        chains,
        chainLabels: chains.map(getChainLabel),
        purchases
      };
    })
    .sort(
      (a, b) =>
        b.monthVolumeUsd - a.monthVolumeUsd ||
        b.monthBuys - a.monthBuys ||
        b.lastBuyAt - a.lastBuyAt ||
        a.wallet.localeCompare(b.wallet)
    );

  return {
    month,
    monthStart,
    summary: toAcquisitionMonthRow(summary),
    wallets: rows
  };
}

export function isValidAcquisitionMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value) && getUtcMonthKey(getMonthStartFromKey(value)) === value;
}

function getFirstBuyByWallet(sales: NormalizedSale[]): Map<string, WalletFirstBuy> {
  const firstBuyByWallet = new Map<string, WalletFirstBuy>();

  for (const sale of sales) {
    const current = firstBuyByWallet.get(sale.wallet);
    if (current === undefined || sale.createdAt < current.createdAt) {
      firstBuyByWallet.set(sale.wallet, {
        createdAt: sale.createdAt,
        month: getUtcMonthKey(sale.createdAt)
      });
    }
  }

  return firstBuyByWallet;
}

function getMutableAcquisitionMonth(months: Map<string, MutableAcquisitionMonth>, month: string, monthStart: number) {
  const existing = months.get(month);
  if (existing) return existing;

  const created: MutableAcquisitionMonth = {
    month,
    monthStart,
    totalVolumeUsd: 0,
    firstTimeBuyerVolumeUsd: 0,
    repeatBuyerVolumeUsd: 0,
    totalBuyers: new Set<string>(),
    firstTimeBuyers: new Set<string>(),
    repeatBuyers: new Set<string>(),
    totalBuys: 0,
    firstTimeBuys: 0,
    repeatBuys: 0
  };
  months.set(month, created);
  return created;
}

function toAcquisitionMonthRow(month: MutableAcquisitionMonth): AcquisitionMonthRow {
  return {
    month: month.month,
    monthStart: month.monthStart,
    totalVolumeUsd: month.totalVolumeUsd,
    firstTimeBuyerVolumeUsd: month.firstTimeBuyerVolumeUsd,
    repeatBuyerVolumeUsd: month.repeatBuyerVolumeUsd,
    firstTimeBuyerVolumeSharePct: getSharePct(month.firstTimeBuyerVolumeUsd, month.totalVolumeUsd),
    totalBuyers: month.totalBuyers.size,
    firstTimeBuyers: month.firstTimeBuyers.size,
    repeatBuyers: month.repeatBuyers.size,
    totalBuys: month.totalBuys,
    firstTimeBuys: month.firstTimeBuys,
    repeatBuys: month.repeatBuys
  };
}

function getSharePct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function getUtcMonthKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getUtcMonthStart(unixSeconds: number): number {
  const date = new Date(unixSeconds * 1000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
}

function addUtcMonth(monthStart: number): number {
  const date = new Date(monthStart * 1000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000);
}

function getMonthStartFromKey(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return NaN;
  return Math.floor(Date.UTC(year, monthNumber - 1, 1) / 1000);
}
