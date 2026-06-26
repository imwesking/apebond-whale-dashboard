import { getChainLabel } from "./tiers.js";
import type { ApeBondSale, BondRow, PartnerRow } from "./types.js";

interface MutablePartnerGroup {
  key: string;
  token: string;
  chainId: number | null;
  chainLabel: string;
  rawBonds: ApeBondSale[];
  bonds: BondRow[];
  totalVolumeUsd: number;
  totalBuys: number;
  activeBonds: number;
  soldOutBonds: number;
  lastBuyAt: number | null;
}

export interface PartnerGroup {
  partner: PartnerRow;
  bonds: BondRow[];
  rawBonds: ApeBondSale[];
  contractSet: Set<string>;
}

export function buildPartnerGroups(rawBonds: ApeBondSale[] = []): PartnerGroup[] {
  const groups = new Map<string, MutablePartnerGroup>();

  for (const rawBond of rawBonds) {
    const contractAddress = normalizeAddress(rawBond.contractAddress ?? rawBond.billAddress);
    if (!contractAddress) continue;

    const token = derivePayoutToken(rawBond);
    const chainId = safeNumber(rawBond.chainId, null);
    const key = makePartnerKey(chainId, token);
    const group =
      groups.get(key) ??
      ({
        key,
        token,
        chainId,
        chainLabel: getChainLabel(chainId),
        rawBonds: [],
        bonds: [],
        totalVolumeUsd: 0,
        totalBuys: 0,
        activeBonds: 0,
        soldOutBonds: 0,
        lastBuyAt: null
      } satisfies MutablePartnerGroup);

    const bond = buildBondRow(rawBond);
    group.rawBonds.push(rawBond);
    group.bonds.push(bond);
    group.totalVolumeUsd += bond.totalVolumeUsd;
    group.totalBuys += bond.totalBuys;
    if (bond.soldOut) group.soldOutBonds += 1;
    else group.activeBonds += 1;
    if (bond.lastBuyAt !== null && (group.lastBuyAt === null || bond.lastBuyAt > group.lastBuyAt)) {
      group.lastBuyAt = bond.lastBuyAt;
    }
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const bonds = dedupeBondRows(group.bonds).sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd);
      const topBond = bonds[0] ?? null;
      return {
        partner: {
          key: group.key,
          token: group.token,
          label: buildPartnerLabel(group.token, group.chainLabel),
          chainId: group.chainId,
          chainLabel: group.chainLabel,
          totalVolumeUsd: group.totalVolumeUsd,
          totalBuys: group.totalBuys,
          totalBonds: bonds.length,
          activeBonds: group.activeBonds,
          soldOutBonds: group.soldOutBonds,
          lastBuyAt: group.lastBuyAt,
          topBond
        },
        bonds,
        rawBonds: group.rawBonds,
        contractSet: new Set(bonds.map((bond) => bond.contractAddress))
      } satisfies PartnerGroup;
    })
    .sort((a, b) => b.partner.totalVolumeUsd - a.partner.totalVolumeUsd);
}

export function findPartnerGroup(groups: PartnerGroup[], chainSegment: string, token: string): PartnerGroup | null {
  const parsedChain = chainSegment === "unknown" ? null : Number(chainSegment);
  const safeChain = Number.isFinite(parsedChain) ? parsedChain : null;
  const key = makePartnerKey(safeChain, token);
  return groups.find((group) => group.partner.key === key) ?? null;
}

export function buildBondRows(rawBonds: ApeBondSale[] = []): BondRow[] {
  return dedupeBondRows(rawBonds.map(buildBondRow)).sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd);
}

export function buildBondRow(rawBond: ApeBondSale): BondRow {
  const payoutToken = derivePayoutToken(rawBond);
  const chainId = safeNumber(rawBond.chainId, null);
  const lp = typeof rawBond.lp === "string" && rawBond.lp.trim() ? rawBond.lp.trim() : payoutToken;
  const lastBuyAt = getLastBuyAt(rawBond);

  return {
    contractAddress: normalizeAddress(rawBond.contractAddress ?? rawBond.billAddress),
    label: lp,
    payoutToken,
    lp,
    chainId,
    chainLabel: getChainLabel(chainId),
    totalVolumeUsd: safeNumber(rawBond.totalDollarValue, safeNumber(rawBond.dollarValue, 0)) ?? 0,
    totalBuys: safeNumber(rawBond.totalSales, 0) ?? 0,
    lastBuyAt,
    percentageSold: safeNumber(rawBond.percentageSold, null),
    soldOut: rawBond.soldOut === true,
    type: typeof rawBond.type === "string" && rawBond.type.trim() ? rawBond.type.trim() : null,
    discountDisplay:
      typeof rawBond.discountDisplay === "string" && rawBond.discountDisplay.trim()
        ? rawBond.discountDisplay.trim()
        : null
  };
}

export function derivePayoutToken(rawBond: ApeBondSale): string {
  if (typeof rawBond.payoutToken === "string" && rawBond.payoutToken.trim()) {
    return rawBond.payoutToken.trim();
  }

  if (typeof rawBond.lp === "string" && rawBond.lp.trim()) {
    const parts = rawBond.lp.split("-").filter(Boolean);
    return (parts[parts.length - 1] ?? rawBond.lp).trim();
  }

  return "Unknown";
}

export function makePartnerKey(chainId: number | null, token: string): string {
  return `${chainId ?? "unknown"}::${token.trim().toLowerCase()}`;
}

export function makePartnerPath(chainId: number | null, token: string): string {
  return `/partner/${chainId ?? "unknown"}/${encodeURIComponent(token)}`;
}

export function normalizeAddress(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function buildPartnerLabel(token: string, chainLabel: string): string {
  return chainLabel === "Unknown" ? token : `${token} on ${chainLabel}`;
}

function getLastBuyAt(rawBond: ApeBondSale): number | null {
  const lastPurchaseAt = safeNumber(rawBond.lastPurchaseDate?.createdAt, null);
  if (lastPurchaseAt !== null && lastPurchaseAt > 0) return lastPurchaseAt;

  const createdAt = safeNumber(rawBond.createdAt, null);
  return createdAt !== null && createdAt > 0 ? createdAt : null;
}

function dedupeBondRows(rows: BondRow[]): BondRow[] {
  const byContract = new Map<string, BondRow>();
  for (const row of rows) {
    if (!row.contractAddress) continue;
    const existing = byContract.get(row.contractAddress);
    if (!existing || row.totalVolumeUsd > existing.totalVolumeUsd || row.totalBuys > existing.totalBuys) {
      byContract.set(row.contractAddress, row);
    }
  }
  return Array.from(byContract.values());
}

function safeNumber(value: unknown, fallback: number): number;
function safeNumber(value: unknown, fallback: null): number | null;
function safeNumber(value: unknown, fallback: number | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
