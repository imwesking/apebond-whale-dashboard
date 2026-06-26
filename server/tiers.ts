export const TIER_LABELS: Record<number, string> = {
  0: "Bronze",
  1: "Silver",
  2: "Gold",
  3: "Diamond",
  4: "Legend",
  5: "Mythical"
};

export const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  56: "BNB",
  137: "Polygon",
  8453: "Base",
  999: "HyperEVM",
  101: "Solana",
  7565164: "Solana"
};

export function getTierLabel(tier: number | null | undefined): string {
  if (tier === null || tier === undefined) return "No tier";
  return TIER_LABELS[tier] ?? `Tier ${tier}`;
}

export function getChainLabel(chainId: number | null | undefined): string {
  if (chainId === null || chainId === undefined) return "Unknown";
  return CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
}
