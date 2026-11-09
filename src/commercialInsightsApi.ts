import type { CommercialInsightsResponse } from "../server/commercialInsightsTypes";

export async function fetchCommercialInsights(month?: string, signal?: AbortSignal): Promise<CommercialInsightsResponse> {
  const query = month ? `?${new URLSearchParams({ month }).toString()}` : "";
  const response = await fetch(`/api/commercial-insights${query}`, { signal });
  const data = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(typeof data.error === "string" ? data.error : "Unable to load commercial insights.");
  }
  return data as CommercialInsightsResponse;
}
