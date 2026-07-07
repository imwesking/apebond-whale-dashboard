import type { Scope, SortKey, WhaleQuery } from "./types.js";
import { VALID_PERIOD_SCOPES } from "./types.js";

const SORTS: SortKey[] = [
  "volume_desc",
  "volume_asc",
  "buys_desc",
  "buys_asc",
  "bonds_desc",
  "bonds_asc",
  "last_desc",
  "last_asc",
  "last_buy_usd_desc",
  "last_buy_usd_asc",
  "tier_desc",
  "tier_asc",
  "chains_desc",
  "chains_asc",
  "wallet_asc",
  "wallet_desc"
];

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

const MAX_ROW_LIMIT = 5000;

export function parseScope(value: unknown): Scope {
  if (value === "all" || value === undefined) return "all";
  if (typeof value === "string" && VALID_PERIOD_SCOPES.includes(value as never)) return value as Scope;
  throw new Error("Invalid scope");
}

export function parseWhaleQuery(query: Record<string, unknown>): WhaleQuery {
  const scope = parseScope(query.scope);
  const chainId = query.chainId ? Number(query.chainId) : undefined;
  const tier =
    query.tier === "none"
      ? "none"
      : query.tier !== undefined && query.tier !== ""
        ? Number(query.tier)
        : undefined;
  const { limit, offset, sort, secondarySort } = parseWalletRowsQuery(query, 50);
  const partnerKeys = parsePartnerKeys(query.partners);
  const dateFrom = parseDateBoundary(query.dateFrom ?? query.from, "start", "dateFrom");
  const dateTo = parseDateBoundary(query.dateTo ?? query.to, "end", "dateTo");

  if (chainId !== undefined && !Number.isFinite(chainId)) throw new Error("Invalid chainId");
  if (typeof tier === "number" && !Number.isFinite(tier)) throw new Error("Invalid tier");
  if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) throw new Error("Invalid date range");

  return {
    scope,
    chainId,
    partnerKeys,
    tier,
    q: typeof query.q === "string" ? query.q : undefined,
    dateFrom,
    dateTo,
    hideLowValue: query.hideLowValue === "true" || query.hideLowValue === true,
    limit,
    offset,
    sort,
    secondarySort
  };
}

export function parseWalletRowsQuery(
  query: Record<string, unknown>,
  defaultLimit = 100
): Pick<WhaleQuery, "limit" | "offset" | "sort" | "secondarySort"> {
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), MAX_ROW_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const sort = SORTS.includes(query.sort as SortKey) ? (query.sort as SortKey) : "volume_desc";
  const requestedSecondarySort = SORTS.includes(query.secondarySort as SortKey)
    ? (query.secondarySort as SortKey)
    : undefined;
  const secondarySort =
    requestedSecondarySort && SORT_FIELDS[requestedSecondarySort] !== SORT_FIELDS[sort]
      ? requestedSecondarySort
      : undefined;

  return { limit, offset, sort, secondarySort };
}

function parseDateBoundary(value: unknown, boundary: "start" | "end", field: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    throw new Error(`Invalid ${field}`);
  }

  const [year, month, day] = rawValue.split("-").map(Number);
  const dateMs =
    boundary === "start"
      ? Date.UTC(year, month - 1, day, 0, 0, 0, 0)
      : Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const date = new Date(dateMs);

  if (
    !Number.isFinite(dateMs) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${field}`);
  }

  return Math.floor(dateMs / 1000);
}

function parsePartnerKeys(value: unknown): string[] | undefined {
  if (value === undefined || value === "" || value === "all") return undefined;

  const rawValues = Array.isArray(value) ? value.flatMap((item) => String(item).split(",")) : String(value).split(",");
  if (rawValues.some((item) => item.trim().toLowerCase() === "none")) return [];

  const keys = rawValues.map(normalizePartnerKey).filter((key): key is string => Boolean(key));
  return Array.from(new Set(keys));
}

function normalizePartnerKey(value: string): string | null {
  const [chainRaw, ...tokenParts] = value.trim().split("::");
  const token = tokenParts.join("::").trim().toLowerCase();
  if (!chainRaw || !token) return null;
  if (chainRaw === "unknown") return `unknown::${token}`;

  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId)) return null;
  return `${chainId}::${token}`;
}
