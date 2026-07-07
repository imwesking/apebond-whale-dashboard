import type {
  AcquisitionMonthDetailResponse,
  AcquisitionResponse,
  BondDetailResponse,
  PartnerDetailResponse,
  PartnerListResponse,
  Scope,
  SortKey,
  WalletDetail,
  WhaleResponse
} from "./types";

export interface WhaleParams {
  scope: Scope;
  chainId?: string;
  partnerKeys?: string[];
  tier?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  hideLowValue?: boolean;
  limit?: number;
  offset?: number;
  sort?: SortKey;
  secondarySort?: SortKey;
}

export interface WalletRowsParams {
  limit?: number;
  offset?: number;
  sort?: SortKey;
  secondarySort?: SortKey;
}

function buildQuery(params: WhaleParams): string {
  const query = new URLSearchParams();
  query.set("scope", params.scope);
  if (params.chainId) query.set("chainId", params.chainId);
  if (params.partnerKeys) {
    query.set("partners", params.partnerKeys.length > 0 ? params.partnerKeys.join(",") : "none");
  }
  if (params.tier) query.set("tier", params.tier);
  if (params.q) query.set("q", params.q);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.hideLowValue) query.set("hideLowValue", "true");
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.sort) query.set("sort", params.sort);
  if (params.secondarySort) query.set("secondarySort", params.secondarySort);
  return query.toString();
}

function buildWalletRowsQuery(params: WalletRowsParams = {}): string {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.sort) query.set("sort", params.sort);
  if (params.secondarySort) query.set("secondarySort", params.secondarySort);
  return query.toString();
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

export function fetchWhales(params: WhaleParams): Promise<WhaleResponse> {
  return readJson<WhaleResponse>(`/api/whales?${buildQuery(params)}`);
}

export function fetchMonthlyAcquisition(): Promise<AcquisitionResponse> {
  return readJson<AcquisitionResponse>("/api/acquisition/monthly");
}

export function fetchMonthlyAcquisitionDetail(month: string): Promise<AcquisitionMonthDetailResponse> {
  return readJson<AcquisitionMonthDetailResponse>(`/api/acquisition/monthly/${encodeURIComponent(month)}`);
}

export function fetchWallet(address: string): Promise<WalletDetail> {
  return readJson<WalletDetail>(`/api/wallet/${address}`);
}

export function fetchPartners(): Promise<PartnerListResponse> {
  return readJson<PartnerListResponse>("/api/partners");
}

export function fetchPartner(chainId: string, token: string, params?: WalletRowsParams): Promise<PartnerDetailResponse> {
  const query = buildWalletRowsQuery(params);
  const suffix = query ? `?${query}` : "";
  return readJson<PartnerDetailResponse>(`/api/partner/${chainId}/${encodeURIComponent(token)}${suffix}`);
}

export function fetchBond(address: string, params?: WalletRowsParams): Promise<BondDetailResponse> {
  const query = buildWalletRowsQuery(params);
  const suffix = query ? `?${query}` : "";
  return readJson<BondDetailResponse>(`/api/bond/${address}${suffix}`);
}
