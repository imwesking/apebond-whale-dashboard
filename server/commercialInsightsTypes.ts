import type { ProgressState } from "./types.js";

export interface CommercialPeriod {
  month: string;
  start: number;
  /** Exclusive UTC boundary, in Unix seconds. */
  end: number;
  available: boolean;
}

export interface CommercialSummary {
  volumeUsd: number;
  buyers: number;
  purchases: number;
  averagePurchaseUsd: number | null;
  medianPurchaseUsd: number | null;
  newBuyers: number;
  returningBuyers: number;
  newVolumeUsd: number;
  returningVolumeUsd: number;
}

export interface CommercialTrendRow {
  month: string;
  volumeUsd: number;
  newVolumeUsd: number;
  returningVolumeUsd: number;
  available: boolean;
}

export interface CommercialProduct {
  key: string;
  token: string;
  chainId: number | null;
  chainLabel: string;
  volumeUsd: number;
  previousVolumeUsd: number | null;
  changeUsd: number | null;
  changePct: number | null;
  buyers: number;
  purchases: number;
  medianPurchaseUsd: number | null;
  largestWalletSharePct: number | null;
  catalogue: { soldOut: number; notSoldOut: number; unknown: number };
}

export interface CommercialWalletRow {
  wallet: string;
  volumeUsd: number;
  purchases: number;
  lastBuyAt: number;
  activeMonths: number;
  preferredProducts: Array<{ key: string; token: string; chainId: number | null; volumeUsd: number }>;
}

export interface CommercialQuality {
  salesAsOf: string;
  catalogueAsOf: string | null;
  failedContracts: number;
  partial: boolean;
  stale: boolean;
  warnings: string[];
}

export interface CommercialInsightsReadyResponse {
  status: "ready";
  month: string;
  availableMonths: string[];
  period: CommercialPeriod;
  previousPeriod: CommercialPeriod;
  yearAgoPeriod: CommercialPeriod;
  summary: CommercialSummary;
  comparisons: { previous: CommercialSummary | null; yearAgo: CommercialSummary | null };
  trend: CommercialTrendRow[];
  products: CommercialProduct[];
  buyerSegments: {
    thresholds: Array<{ minimumUsd: number; wallets: number }>;
    smallOnly: { wallets: number; volumeUsd: number };
  };
  concentration: {
    top1WalletPct: number | null;
    top5WalletPct: number | null;
    top10WalletPct: number | null;
    top3ProductsPct: number | null;
  };
  wallets: {
    current: CommercialWalletRow[];
    inactive: CommercialWalletRow[];
    totalCurrent: number;
    totalInactive: number;
    lookbackStart: number;
    lookbackEnd: number;
  };
  observations: string[];
  quality: CommercialQuality;
}

export interface CommercialInsightsBuildingResponse {
  status: "building";
  progress: ProgressState;
}

export type CommercialInsightsResponse = CommercialInsightsReadyResponse | CommercialInsightsBuildingResponse;
