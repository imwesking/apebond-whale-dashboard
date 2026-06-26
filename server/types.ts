export const VALID_PERIOD_SCOPES = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month"
] as const;

export type PeriodScope = (typeof VALID_PERIOD_SCOPES)[number];
export type Scope = "all" | PeriodScope;

export type SortKey =
  | "volume_desc"
  | "volume_asc"
  | "buys_desc"
  | "buys_asc"
  | "bonds_desc"
  | "bonds_asc"
  | "last_desc"
  | "last_asc"
  | "last_buy_usd_desc"
  | "last_buy_usd_asc"
  | "tier_desc"
  | "tier_asc"
  | "chains_desc"
  | "chains_asc"
  | "wallet_asc"
  | "wallet_desc";

export interface ApeBondSale {
  lp?: string;
  contractAddress?: string;
  billAddress?: string;
  billNftId?: number;
  createdAddressOwner?: string;
  createdAt?: number;
  dollarValue?: number | string;
  totalDollarValue?: number | string;
  totalSales?: number | string;
  payout?: number;
  payoutTokenPrice?: number;
  tier?: number | null;
  chainId?: number;
  transactionHash?: string;
  payoutToken?: string;
  referenceId?: string;
  deposit?: number | string;
  type?: string;
  percentageSold?: number | string;
  priceUsd?: number | string;
  soldOut?: boolean;
  vestingTerm?: number | string;
  vestingTime?: number | string;
  earnTokenPrice?: number | string;
  tokensRemaining?: number | string;
  totalPayoutGiven?: number | string;
  lastPurchaseDate?: ApeBondSale;
  discount?: number | string;
  discountDisplay?: string;
}

export interface ApeBondSalesInfo {
  bonds?: ApeBondSale[];
  figures?: unknown[];
}

export interface ApeBondPeriodInfo {
  Sales?: ApeBondSale[];
  DateRange?: string;
  UnixDateRange?: string;
  Label?: string;
  TotalSales?: number;
  UniqueWallets?: number;
  DollarValue?: number;
  ChainIdTotals?: unknown[];
}

export interface ApeBondBondInfo {
  percentageSold?: number;
  totalDollarValue?: number;
  ROE?: string;
  valueRemaining?: number;
  Sales?: ApeBondSale[];
}

export interface ApeBondProjectInfo {
  percentageSold?: number;
  totalDollarValue?: number;
  ROE?: string;
  valueRemaining?: number;
  Bonds?: ApeBondSale[];
  Sales?: ApeBondSale[];
}

export interface ApeBondWalletInfo {
  totalDollarValue?: number;
  tier?: number | null;
  Sales?: ApeBondSale[];
}

export interface NormalizedSale {
  key: string;
  lp: string;
  contractAddress: string;
  wallet: string;
  createdAt: number;
  dollarValue: number;
  payout: number;
  payoutTokenPrice: number;
  tier: number | null;
  chainId: number | null;
  transactionHash: string | null;
  payoutToken: string;
}

export interface WhaleWallet {
  rank: number;
  wallet: string;
  totalVolumeUsd: number;
  totalBuys: number;
  totalBonds: number;
  lastBuyAt: number;
  lastBuyUsd: number;
  tier: number | null;
  tierLabel: string;
  chains: number[];
  chainLabels: string[];
}

export interface DashboardSummary {
  scope: Scope;
  uniqueWallets: number;
  totalVolumeUsd: number;
  totalBuys: number;
  uniqueBonds: number;
  lastBuyAt: number | null;
  lastRefreshed: string;
  chainMix: Array<{ chainId: number; label: string; totalVolumeUsd: number; totalBuys: number }>;
  tierMix: Array<{ tier: number | null; label: string; wallets: number; totalVolumeUsd: number }>;
  topWallets: WhaleWallet[];
  sourceUniqueWallets?: number;
  sourceTotalSales?: number;
  sourceDollarValue?: number;
}

export interface AcquisitionMonthRow {
  month: string;
  monthStart: number;
  totalVolumeUsd: number;
  firstTimeBuyerVolumeUsd: number;
  repeatBuyerVolumeUsd: number;
  firstTimeBuyerVolumeSharePct: number;
  totalBuyers: number;
  firstTimeBuyers: number;
  repeatBuyers: number;
  totalBuys: number;
  firstTimeBuys: number;
  repeatBuys: number;
}

export interface AcquisitionSummary {
  months: number;
  totalVolumeUsd: number;
  firstTimeBuyerVolumeUsd: number;
  repeatBuyerVolumeUsd: number;
  firstTimeBuyerVolumeSharePct: number;
  uniqueBuyers: number;
  latestMonth: AcquisitionMonthRow | null;
  peakFirstTimeBuyerMonth: AcquisitionMonthRow | null;
  lastRefreshed: string;
}

export interface AcquisitionReadyResponse {
  status: "ready";
  rows: AcquisitionMonthRow[];
  summary: AcquisitionSummary;
  progress?: ProgressState;
  warnings: string[];
}

export interface AcquisitionBuildingResponse {
  status: "building";
  rows: [];
  summary: null;
  progress: ProgressState;
  warnings: string[];
}

export type AcquisitionResponse = AcquisitionReadyResponse | AcquisitionBuildingResponse;

export interface BondRow {
  contractAddress: string;
  label: string;
  payoutToken: string;
  lp: string;
  chainId: number | null;
  chainLabel: string;
  totalVolumeUsd: number;
  totalBuys: number;
  lastBuyAt: number | null;
  percentageSold: number | null;
  soldOut: boolean;
  type: string | null;
  discountDisplay: string | null;
}

export interface PartnerRow {
  key: string;
  token: string;
  label: string;
  chainId: number | null;
  chainLabel: string;
  totalVolumeUsd: number;
  totalBuys: number;
  totalBonds: number;
  activeBonds: number;
  soldOutBonds: number;
  lastBuyAt: number | null;
  topBond: BondRow | null;
}

export interface PartnerListResponse {
  status: "ready";
  rows: PartnerRow[];
  totalRows: number;
  summary: {
    partners: number;
    totalVolumeUsd: number;
    totalBuys: number;
    uniqueBonds: number;
    lastRefreshed: string;
  };
}

export interface PartnerDetailResponse {
  status: "ready";
  partner: PartnerRow;
  bonds: BondRow[];
  walletRows: WhaleWallet[];
  totalWalletRows: number;
  summary: DashboardSummary;
  warnings: string[];
}

export interface BondDetailResponse {
  status: "ready";
  bond: BondRow;
  walletRows: WhaleWallet[];
  totalWalletRows: number;
  summary: DashboardSummary;
  sales: NormalizedSale[];
  warnings: string[];
}

export interface WhaleQuery {
  scope: Scope;
  chainId?: number;
  partnerKeys?: string[];
  tier?: number | "none";
  q?: string;
  dateFrom?: number;
  dateTo?: number;
  hideLowValue?: boolean;
  limit: number;
  offset: number;
  sort: SortKey;
  secondarySort?: SortKey;
}

export interface ProgressState {
  status: "empty" | "building" | "ready" | "error";
  total: number;
  completed: number;
  failed: number;
  current?: string;
  startedAt?: string;
  updatedAt?: string;
  builtAt?: string;
  expiresAt?: string;
  error?: string;
}

export interface WhaleResponse {
  status: "ready";
  scope: Scope;
  rows: WhaleWallet[];
  totalRows: number;
  summary: DashboardSummary;
  progress?: ProgressState;
  warnings: string[];
}

export interface BuildingResponse {
  status: "building";
  scope: Scope;
  rows: [];
  totalRows: 0;
  summary: null;
  progress: ProgressState;
  warnings: string[];
}

export interface WalletDetail {
  wallet: string;
  summary: {
    totalVolumeUsd: number;
    totalBuys: number;
    totalBonds: number;
    firstBuyAt: number | null;
    lastBuyAt: number | null;
    tier: number | null;
    tierLabel: string;
  };
  sales: NormalizedSale[];
}
