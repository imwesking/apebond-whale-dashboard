import type {
  ApeBondBondInfo,
  ApeBondPeriodInfo,
  ApeBondProjectInfo,
  ApeBondSalesInfo,
  ApeBondWalletInfo,
  PeriodScope
} from "./types.js";

const API_BASE = "https://api.ape.bond";

export class ApeBondApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string
  ) {
    super(message);
  }
}

export interface ApeBondDataClient {
  getSalesInfo(): Promise<ApeBondSalesInfo>;
  getPeriodSales(scope: PeriodScope): Promise<ApeBondPeriodInfo>;
  getBondSales(contractAddress: string): Promise<ApeBondBondInfo>;
  getProjectSales(project: string): Promise<ApeBondProjectInfo>;
  getWalletSales(wallet: string): Promise<ApeBondWalletInfo>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApeBondApiError(response.status, path, `ApeBond API ${response.status} for ${path}: ${body.slice(0, 160)}`);
  }

  return (await response.json()) as T;
}

export class ApeBondClient implements ApeBondDataClient {
  getSalesInfo(): Promise<ApeBondSalesInfo> {
    return fetchJson<ApeBondSalesInfo>("/collector/salesInfo");
  }

  getPeriodSales(scope: PeriodScope): Promise<ApeBondPeriodInfo> {
    return fetchJson<ApeBondPeriodInfo>(`/collector/salesInfo/period/${scope}/0`);
  }

  getBondSales(contractAddress: string): Promise<ApeBondBondInfo> {
    return fetchJson<ApeBondBondInfo>(`/collector/salesInfo/bond/${contractAddress}/0`);
  }

  getProjectSales(project: string): Promise<ApeBondProjectInfo> {
    return fetchJson<ApeBondProjectInfo>(`/collector/salesInfo/project/${encodeURIComponent(project)}/0`);
  }

  getWalletSales(wallet: string): Promise<ApeBondWalletInfo> {
    return fetchJson<ApeBondWalletInfo>(`/collector/userSalesInfo/purchased/${wallet}`);
  }
}
