import {
  ArrowDownUp,
  BadgeDollarSign,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers3,
  ListFilter,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fetchBond, fetchMonthlyAcquisition, fetchPartner, fetchPartners, fetchWallet, fetchWhales } from "./api";
import { formatDate, formatNumber, formatUsd, percent, shortenAddress } from "./format";
import type {
  AcquisitionMonthRow,
  AcquisitionReadyResponse,
  AcquisitionResponse,
  BondDetailResponse,
  DashboardSummary,
  PartnerDetailResponse,
  PartnerListResponse,
  PartnerRow,
  NormalizedSale,
  Scope,
  SortKey,
  WalletDetail,
  WhaleReadyResponse,
  WhaleResponse
} from "./types";

const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: "all", label: "All-time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" }
];

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "volume_desc", label: "Volume high to low" },
  { value: "volume_asc", label: "Volume low to high" },
  { value: "buys_desc", label: "Buys high to low" },
  { value: "buys_asc", label: "Buys low to high" },
  { value: "bonds_desc", label: "Bonds high to low" },
  { value: "bonds_asc", label: "Bonds low to high" },
  { value: "last_desc", label: "Last buy newest" },
  { value: "last_asc", label: "Last buy oldest" },
  { value: "last_buy_usd_desc", label: "Last buy $ high to low" },
  { value: "last_buy_usd_asc", label: "Last buy $ low to high" },
  { value: "tier_desc", label: "Tier high to low" },
  { value: "tier_asc", label: "Tier low to high" },
  { value: "chains_desc", label: "Chains most to fewest" },
  { value: "chains_asc", label: "Chains fewest to most" },
  { value: "wallet_asc", label: "Wallet A to Z" },
  { value: "wallet_desc", label: "Wallet Z to A" }
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

const HEADER_SORTS: Record<string, { asc: SortKey; desc: SortKey; first: "asc" | "desc" }> = {
  wallet: { asc: "wallet_asc", desc: "wallet_desc", first: "asc" },
  volume: { asc: "volume_asc", desc: "volume_desc", first: "desc" },
  buys: { asc: "buys_asc", desc: "buys_desc", first: "desc" },
  bonds: { asc: "bonds_asc", desc: "bonds_desc", first: "desc" },
  last: { asc: "last_asc", desc: "last_desc", first: "desc" },
  lastBuyUsd: { asc: "last_buy_usd_asc", desc: "last_buy_usd_desc", first: "desc" },
  tier: { asc: "tier_asc", desc: "tier_desc", first: "desc" },
  chains: { asc: "chains_asc", desc: "chains_desc", first: "desc" }
};

type SaleSortKey =
  | "wallet_asc"
  | "wallet_desc"
  | "amount_desc"
  | "amount_asc"
  | "payout_desc"
  | "payout_asc"
  | "tier_desc"
  | "tier_asc"
  | "chain_desc"
  | "chain_asc"
  | "date_desc"
  | "date_asc";

const SALE_HEADER_SORTS: Record<string, { asc: SaleSortKey; desc: SaleSortKey; first: "asc" | "desc" }> = {
  wallet: { asc: "wallet_asc", desc: "wallet_desc", first: "asc" },
  amount: { asc: "amount_asc", desc: "amount_desc", first: "desc" },
  payout: { asc: "payout_asc", desc: "payout_desc", first: "desc" },
  tier: { asc: "tier_asc", desc: "tier_desc", first: "desc" },
  chain: { asc: "chain_asc", desc: "chain_desc", first: "desc" },
  date: { asc: "date_asc", desc: "date_desc", first: "desc" }
};

const TIER_OPTIONS = [
  { value: "", label: "All tiers" },
  { value: "5", label: "Mythical" },
  { value: "4", label: "Legend" },
  { value: "3", label: "Diamond" },
  { value: "2", label: "Gold" },
  { value: "1", label: "Silver" },
  { value: "0", label: "Bronze" },
  { value: "none", label: "No tier" }
];

const TIER_LABELS: Record<number, string> = {
  0: "Bronze",
  1: "Silver",
  2: "Gold",
  3: "Diamond",
  4: "Legend",
  5: "Mythical"
};

const CHART_COLORS = ["#0f7b61", "#2f6f9f", "#b56b16", "#7367a8", "#487646", "#9a554e"];
const PAGE_SIZE = 50;

type AcquisitionChartPoint = AcquisitionMonthRow & { label: string };

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return path;
}

function partnerPath(partner: PartnerRow) {
  return `/partner/${partner.chainId ?? "unknown"}/${encodeURIComponent(partner.token)}`;
}

function bondPath(address: string) {
  return `/bond/${encodeURIComponent(address.toLowerCase())}`;
}

function PageTabs({ active }: { active: "wallets" | "partners" | "acquisition" }) {
  return (
    <nav className="page-tabs" aria-label="Dashboard pages">
      <button className={active === "wallets" ? "active" : ""} onClick={() => navigate("/")}>
        <WalletCards size={16} />
        <span>Wallet Watch</span>
      </button>
      <button className={active === "acquisition" ? "active" : ""} onClick={() => navigate("/acquisition")}>
        <TrendingUp size={16} />
        <span>Acquisition</span>
      </button>
      <button className={active === "partners" ? "active" : ""} onClick={() => navigate("/partners")}>
        <Layers3 size={16} />
        <span>Partners</span>
      </button>
    </nav>
  );
}

function getSortDirection(sort: SortKey, field: keyof typeof HEADER_SORTS): "asc" | "desc" | null {
  const config = HEADER_SORTS[field];
  if (sort === config.asc) return "asc";
  if (sort === config.desc) return "desc";
  return null;
}

function nextSortForField(current: SortKey, field: keyof typeof HEADER_SORTS): SortKey {
  const config = HEADER_SORTS[field];
  const currentDirection = getSortDirection(current, field);
  if (!currentDirection) return config[config.first];
  return currentDirection === "desc" ? config.asc : config.desc;
}

function fallbackSecondary(primary: SortKey): SortKey {
  return (
    (["volume_desc", "last_desc", "buys_desc", "bonds_desc", "tier_desc", "wallet_asc"] as SortKey[]).find(
      (candidate) => isSecondarySortAllowed(primary, candidate)
    ) ?? "wallet_asc"
  );
}

function isSecondarySortAllowed(primary: SortKey, secondary: SortKey): boolean {
  return SORT_FIELDS[primary] !== SORT_FIELDS[secondary];
}

function sortWhaleRows(rows: WhaleReadyResponse["rows"], sort: SortKey): WhaleReadyResponse["rows"] {
  return [...rows]
    .sort((a, b) => compareWhaleRows(a, b, sort) || compareWhaleRows(a, b, "volume_desc") || a.wallet.localeCompare(b.wallet))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function compareWhaleRows(a: WhaleReadyResponse["rows"][number], b: WhaleReadyResponse["rows"][number], sort: SortKey): number {
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
      return compareTierValues(a.tier, b.tier, "asc");
    case "tier_desc":
      return compareTierValues(a.tier, b.tier, "desc");
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

function compareTierValues(a: number | null, b: number | null, direction: "asc" | "desc") {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function getSaleSortDirection(sort: SaleSortKey, field: keyof typeof SALE_HEADER_SORTS): "asc" | "desc" | null {
  const config = SALE_HEADER_SORTS[field];
  if (sort === config.asc) return "asc";
  if (sort === config.desc) return "desc";
  return null;
}

function nextSaleSortForField(current: SaleSortKey, field: keyof typeof SALE_HEADER_SORTS): SaleSortKey {
  const config = SALE_HEADER_SORTS[field];
  const currentDirection = getSaleSortDirection(current, field);
  if (!currentDirection) return config[config.first];
  return currentDirection === "desc" ? config.asc : config.desc;
}

function sortSales(rows: NormalizedSale[], sort: SaleSortKey): NormalizedSale[] {
  return [...rows].sort((a, b) => compareSales(a, b, sort) || compareSales(a, b, "date_desc") || a.wallet.localeCompare(b.wallet));
}

function compareSales(a: NormalizedSale, b: NormalizedSale, sort: SaleSortKey): number {
  switch (sort) {
    case "wallet_desc":
      return b.wallet.localeCompare(a.wallet);
    case "wallet_asc":
      return a.wallet.localeCompare(b.wallet);
    case "amount_asc":
      return a.dollarValue - b.dollarValue;
    case "amount_desc":
      return b.dollarValue - a.dollarValue;
    case "payout_asc":
      return a.payout - b.payout;
    case "payout_desc":
      return b.payout - a.payout;
    case "tier_asc":
      return compareTierValues(a.tier, b.tier, "asc");
    case "tier_desc":
      return compareTierValues(a.tier, b.tier, "desc");
    case "chain_asc":
      return compareNullableNumbers(a.chainId, b.chainId, "asc");
    case "chain_desc":
      return compareNullableNumbers(a.chainId, b.chainId, "desc");
    case "date_asc":
      return a.createdAt - b.createdAt;
    case "date_desc":
      return b.createdAt - a.createdAt;
    default:
      return 0;
  }
}

function compareNullableNumbers(a: number | null, b: number | null, direction: "asc" | "desc"): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function formatShare(value: number): string {
  return `${(value || 0).toFixed(1)}%`;
}

function formatMonth(timestamp: number | null | undefined, long = false): string {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: long ? "long" : "short",
    year: long ? "numeric" : "2-digit"
  }).format(new Date(timestamp * 1000));
}

function KpiStrip({ summary }: { summary: DashboardSummary | null }) {
  const metrics = [
    ["Unique wallets", summary ? formatNumber(summary.uniqueWallets) : "-"],
    ["Total volume", summary ? formatUsd(summary.totalVolumeUsd, true) : "-"],
    ["Total buys", summary ? formatNumber(summary.totalBuys) : "-"],
    ["Unique bonds", summary ? formatNumber(summary.uniqueBonds) : "-"],
    [
      summary?.scope === "all" ? "Index built" : "Last refreshed",
      summary ? new Date(summary.lastRefreshed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"
    ]
  ];

  return (
    <section className="kpi-strip" aria-label="Dashboard metrics">
      {metrics.map(([label, value]) => (
        <div className="kpi" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function PartnerFilter({
  partners,
  excludedKeys,
  selectedCount,
  search,
  onSearch,
  onToggleAll,
  onTogglePartner
}: {
  partners: PartnerRow[];
  excludedKeys: Set<string>;
  selectedCount: number;
  search: string;
  onSearch: (value: string) => void;
  onToggleAll: (checked: boolean) => void;
  onTogglePartner: (partnerKey: string, checked: boolean) => void;
}) {
  const term = search.trim().toLowerCase();
  const filteredPartners = useMemo(() => {
    if (!term) return partners;
    return partners.filter(
      (partner) =>
        partner.token.toLowerCase().includes(term) ||
        partner.label.toLowerCase().includes(term) ||
        partner.chainLabel.toLowerCase().includes(term)
    );
  }, [partners, term]);
  const allSelected = partners.length > 0 && selectedCount === partners.length;
  const summary =
    partners.length === 0
      ? "Loading partners"
      : allSelected
        ? "ALL partners"
        : selectedCount === 0
          ? "No partners"
          : `${selectedCount}/${partners.length} partners`;

  return (
    <div className="partner-filter">
      <span>Partners</span>
      <details>
        <summary>
          <ListFilter size={16} />
          <span>{summary}</span>
        </summary>
        <div className="partner-menu">
          <label className="partner-option all">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={partners.length === 0}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
            <span>ALL</span>
            <small>{formatNumber(partners.length)} partners</small>
          </label>
          <label className="partner-search">
            <Search size={15} />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search partner" />
          </label>
          <div className="partner-options">
            {filteredPartners.map((partner) => (
              <label className="partner-option" key={partner.key}>
                <input
                  type="checkbox"
                  checked={!excludedKeys.has(partner.key)}
                  onChange={(event) => onTogglePartner(partner.key, event.target.checked)}
                />
                <span>{partner.token}</span>
                <small>
                  {partner.chainLabel} - {formatNumber(partner.totalBonds)} bonds
                </small>
              </label>
            ))}
            {filteredPartners.length === 0 && <div className="partner-empty">No partners match</div>}
          </div>
        </div>
      </details>
    </div>
  );
}

function Dashboard() {
  const [scope, setScope] = useState<Scope>("all");
  const [chainId, setChainId] = useState("");
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [excludedPartnerKeys, setExcludedPartnerKeys] = useState<string[]>([]);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [tier, setTier] = useState("");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hideLowValue, setHideLowValue] = useState(false);
  const [sort, setSort] = useState<SortKey>("volume_desc");
  const [secondarySort, setSecondarySort] = useState<SortKey>("last_desc");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<WhaleReadyResponse | null>(null);
  const [building, setBuilding] = useState<WhaleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const excludedPartnerSet = useMemo(() => new Set(excludedPartnerKeys), [excludedPartnerKeys]);
  const selectedPartnerKeys = useMemo(
    () => partners.filter((partner) => !excludedPartnerSet.has(partner.key)).map((partner) => partner.key),
    [partners, excludedPartnerSet]
  );
  const partnerKeysForQuery =
    partners.length === 0 || selectedPartnerKeys.length === partners.length ? undefined : selectedPartnerKeys;
  const partnerFilterSignature = partnerKeysForQuery ? partnerKeysForQuery.join("|") : "all";

  const load = async () => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setError(null);
    try {
      const result = await fetchWhales({
        scope,
        chainId,
        partnerKeys: partnerKeysForQuery,
        tier,
        q: query,
        dateFrom,
        dateTo,
        hideLowValue,
        limit: PAGE_SIZE,
        offset,
        sort,
        secondarySort
      });

      if (requestId !== requestSeq.current) return;

      if (result.status === "building") {
        setBuilding(result);
        return;
      }

      setBuilding(null);
      setData(result);
    } catch (err) {
      if (requestId !== requestSeq.current) return;
      setBuilding(null);
      setError(err instanceof Error ? err.message : "Unable to load ApeBond data");
    }
  };

  useEffect(() => {
    void load();
  }, [scope, chainId, partnerFilterSignature, tier, query, dateFrom, dateTo, hideLowValue, sort, secondarySort, offset]);

  useEffect(() => {
    if (!building) return;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [building, scope, chainId, partnerFilterSignature, tier, query, dateFrom, dateTo, hideLowValue, sort, secondarySort, offset]);

  useEffect(() => setOffset(0), [scope, chainId, partnerFilterSignature, tier, query, dateFrom, dateTo, hideLowValue, sort, secondarySort]);

  useEffect(() => {
    fetchPartners()
      .then((result) => {
        setPartners(result.rows);
        setExcludedPartnerKeys((current) => current.filter((key) => result.rows.some((partner) => partner.key === key)));
      })
      .catch(() => {
        setPartners([]);
      });
  }, []);

  const updateSort = (nextSort: SortKey) => {
    setSort(nextSort);
    if (!isSecondarySortAllowed(nextSort, secondarySort)) {
      setSecondarySort(fallbackSecondary(nextSort));
    }
  };

  const updateSecondarySort = (nextSecondarySort: SortKey) => {
    setSecondarySort(isSecondarySortAllowed(sort, nextSecondarySort) ? nextSecondarySort : fallbackSecondary(sort));
  };

  const updateDateFrom = (value: string) => {
    setDateFrom(value);
    if (value && dateTo && value > dateTo) {
      setDateTo(value);
    }
  };

  const updateDateTo = (value: string) => {
    setDateTo(value);
    if (value && dateFrom && value < dateFrom) {
      setDateFrom(value);
    }
  };

  const handleHeaderSort = (field: keyof typeof HEADER_SORTS) => {
    updateSort(nextSortForField(sort, field));
  };

  const setAllPartners = (checked: boolean) => {
    setExcludedPartnerKeys(checked ? [] : partners.map((partner) => partner.key));
  };

  const togglePartner = (partnerKey: string, checked: boolean) => {
    setExcludedPartnerKeys((current) => {
      const next = new Set(current);
      if (checked) next.delete(partnerKey);
      else next.add(partnerKey);
      return Array.from(next);
    });
  };

  const summary = data?.summary ?? null;
  const chainOptions = summary?.chainMix ?? [];
  const topWalletChart = useMemo(
    () =>
      (summary?.topWallets ?? []).map((wallet) => ({
        wallet: shortenAddress(wallet.wallet),
        volume: Math.round(wallet.totalVolumeUsd),
        full: wallet.wallet
      })),
    [summary]
  );

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">ApeBond community reach</p>
          <h1>Wallet Watch</h1>
        </div>
        <div className="header-actions">
          <PageTabs active="wallets" />
        </div>
      </header>

      <KpiStrip summary={summary} />

      <section className="controls" aria-label="Dashboard filters">
        <label>
          <span>Scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
            {SCOPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Chain</span>
          <select value={chainId} onChange={(event) => setChainId(event.target.value)}>
            <option value="">All chains</option>
            {chainOptions.map((chain) => (
              <option key={chain.chainId} value={chain.chainId}>
                {chain.label}
              </option>
            ))}
          </select>
        </label>
        <PartnerFilter
          partners={partners}
          excludedKeys={excludedPartnerSet}
          selectedCount={selectedPartnerKeys.length}
          search={partnerSearch}
          onSearch={setPartnerSearch}
          onToggleAll={setAllPartners}
          onTogglePartner={togglePartner}
        />
        <label>
          <span>Tier</span>
          <select value={tier} onChange={(event) => setTier(event.target.value)}>
            {TIER_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="date-field">
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onInput={(event) => updateDateFrom(event.currentTarget.value)}
            onChange={(event) => updateDateFrom(event.target.value)}
            onBlur={(event) => updateDateFrom(event.currentTarget.value)}
          />
        </label>
        <label className="date-field">
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onInput={(event) => updateDateTo(event.currentTarget.value)}
            onChange={(event) => updateDateTo(event.target.value)}
            onBlur={(event) => updateDateTo(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Primary</span>
          <select value={sort} onChange={(event) => updateSort(event.target.value as SortKey)}>
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Then by</span>
          <select value={secondarySort} onChange={(event) => updateSecondarySort(event.target.value as SortKey)}>
            {SORTS.filter((item) => isSecondarySortAllowed(sort, item.value)).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>Wallet</span>
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="0x..." />
        </label>
        <label className="toggle">
          <input checked={hideLowValue} onChange={(event) => setHideLowValue(event.target.checked)} type="checkbox" />
          <span>Hide &lt;$10 buys</span>
        </label>
      </section>

      {building?.status === "building" && (
        <section className="progress-band" aria-live="polite">
          <div>
            <strong>{building.progress.status === "error" ? "All-time index paused" : "Building all-time index"}</strong>
            <span>
              {building.progress.completed}/{building.progress.total || "?"} bonds scanned
              {building.progress.failed ? `, ${building.progress.failed} failed` : ""}
            </span>
          </div>
          {building.progress.error && <span className="progress-error">{building.progress.error}</span>}
          <div className="progress-track">
            <span style={{ width: `${percent(building.progress)}%` }} />
          </div>
        </section>
      )}

      {error && (
        <section className="error-band">
          <strong>Could not load data</strong>
          <span>{error}</span>
        </section>
      )}

      <section className="content-grid">
        <div className="table-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ranked by bonded volume</p>
              <h2>Top ApeBond wallets</h2>
            </div>
            <span>{data ? formatNumber(data.totalRows) : "0"} wallets</span>
          </div>

          <WhaleTable data={data} sort={sort} onSort={handleHeaderSort} />

          <div className="pager">
            <button className="icon-button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
              <ChevronLeft size={16} />
              <span>Prev</span>
            </button>
            <span>
              {offset + 1}-{Math.min(offset + PAGE_SIZE, data?.totalRows ?? 0)}
            </span>
            <button
              className="icon-button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!data || offset + PAGE_SIZE >= data.totalRows}
            >
              <span>Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <aside className="insights">
          <ChartPanel title="Top 10 volume">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topWalletChart} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#d8ded8" />
                <XAxis type="number" tickFormatter={(value) => formatUsd(Number(value), true)} />
                <YAxis type="category" dataKey="wallet" width={92} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => formatUsd(Number(value))} labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""} />
                <Bar dataKey="volume" radius={[0, 4, 4, 0]} fill="#0f7b61" />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Tier mix">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={summary?.tierMix ?? []} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8ded8" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(value, name) => [formatNumber(Number(value)), name]} />
                <Bar dataKey="wallets" radius={[4, 4, 0, 0]}>
                  {(summary?.tierMix ?? []).map((_, index) => (
                    <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Chain mix">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={summary?.chainMix ?? []} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8ded8" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => formatUsd(Number(value), true)} />
                <Tooltip formatter={(value) => formatUsd(Number(value))} />
                <Legend />
                <Bar name="Volume" dataKey="totalVolumeUsd" radius={[4, 4, 0, 0]} fill="#2f6f9f" />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>
        </aside>
      </section>
    </main>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="chart-panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function AcquisitionTooltip({
  active,
  payload
}: {
  active?: boolean;
  payload?: Array<{ payload: AcquisitionChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <strong>{formatMonth(row.monthStart, true)}</strong>
      <span>First-time volume: {formatUsd(row.firstTimeBuyerVolumeUsd)}</span>
      <span>Total volume: {formatUsd(row.totalVolumeUsd)}</span>
      <span>New share: {formatShare(row.firstTimeBuyerVolumeSharePct)}</span>
      <span>
        Buyers: {formatNumber(row.firstTimeBuyers)} new / {formatNumber(row.repeatBuyers)} repeat
      </span>
    </div>
  );
}

function AcquisitionPage() {
  const [data, setData] = useState<AcquisitionReadyResponse | null>(null);
  const [building, setBuilding] = useState<AcquisitionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeq = useRef(0);

  const load = async () => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setError(null);
    setLoading(true);

    try {
      const result = await fetchMonthlyAcquisition();
      if (requestId !== requestSeq.current) return;

      if (result.status === "building") {
        setBuilding(result);
        return;
      }

      setBuilding(null);
      setData(result);
    } catch (err) {
      if (requestId !== requestSeq.current) return;
      setBuilding(null);
      setError(err instanceof Error ? err.message : "Unable to load acquisition data");
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!building) return;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [building]);

  const chartData = useMemo<AcquisitionChartPoint[]>(
    () =>
      (data?.rows ?? []).map((row) => ({
        ...row,
        label: formatMonth(row.monthStart)
      })),
    [data]
  );
  const latest = data?.summary.latestMonth ?? null;
  const peak = data?.summary.peakFirstTimeBuyerMonth ?? null;
  const recentRows = useMemo(() => [...(data?.rows ?? [])].slice(-12).reverse(), [data]);

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Funnel expansion</p>
          <h1>Buyer Acquisition</h1>
        </div>
        <div className="header-actions">
          <PageTabs active="acquisition" />
          <button className="icon-button primary" onClick={() => void load()} disabled={loading} title="Refresh acquisition data">
            <RefreshCcw size={16} />
            <span>{loading ? "Loading" : "Refresh"}</span>
          </button>
        </div>
      </header>

      <section className="kpi-strip" aria-label="Acquisition metrics">
        <div className="kpi">
          <span>Latest new volume</span>
          <strong>{latest ? formatUsd(latest.firstTimeBuyerVolumeUsd, true) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Latest new share</span>
          <strong>{latest ? formatShare(latest.firstTimeBuyerVolumeSharePct) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Latest new buyers</span>
          <strong>{latest ? formatNumber(latest.firstTimeBuyers) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Latest repeat volume</span>
          <strong>{latest ? formatUsd(latest.repeatBuyerVolumeUsd, true) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>History window</span>
          <strong>{data ? formatNumber(data.summary.months) : "-"} mo</strong>
        </div>
      </section>

      {building?.status === "building" && (
        <section className="progress-band" aria-live="polite">
          <div>
            <strong>Building acquisition index</strong>
            <span>
              {building.progress.completed}/{building.progress.total || "?"} bonds scanned
              {building.progress.failed ? `, ${building.progress.failed} failed` : ""}
            </span>
          </div>
          {building.progress.error && <span className="progress-error">{building.progress.error}</span>}
          <div className="progress-track">
            <span style={{ width: `${percent(building.progress)}%` }} />
          </div>
        </section>
      )}

      {error && (
        <section className="error-band">
          <strong>Could not load acquisition</strong>
          <span>{error}</span>
        </section>
      )}

      {data?.warnings.length ? (
        <section className="progress-band">
          <strong>Partial historical index</strong>
          <span>{data.warnings.length} bonds failed during the last all-time scan, so totals may be slightly understated.</span>
        </section>
      ) : null}

      <section className="acquisition-grid">
        <div className="table-panel acquisition-chart-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Monthly first-time buyer volume</p>
              <h2>New buyer volume and share of total volume</h2>
            </div>
            <span>{latest ? `Latest: ${formatMonth(latest.monthStart, true)}` : "Waiting for data"}</span>
          </div>

          {!data ? (
            <div className="empty-state">
              <TrendingUp size={22} />
              <span>Waiting for acquisition index</span>
            </div>
          ) : chartData.length === 0 ? (
            <div className="empty-state">
              <Search size={22} />
              <span>No monthly sales found</span>
            </div>
          ) : (
            <div className="acquisition-chart">
              <ResponsiveContainer width="100%" height={390}>
                <ComposedChart data={chartData} margin={{ top: 18, right: 14, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8ded8" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis yAxisId="volume" tickFormatter={(value) => formatUsd(Number(value), true)} />
                  <YAxis
                    yAxisId="share"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(value) => formatShare(Number(value))}
                  />
                  <Tooltip content={<AcquisitionTooltip />} />
                  <Legend verticalAlign="top" height={34} />
                  <Bar
                    yAxisId="volume"
                    name="First-time buyer volume"
                    dataKey="firstTimeBuyerVolumeUsd"
                    radius={[4, 4, 0, 0]}
                    fill="#0f7b61"
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="share"
                    name="First-time volume share"
                    type="monotone"
                    dataKey="firstTimeBuyerVolumeSharePct"
                    stroke="#b56b16"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <aside className="acquisition-notes">
          <div className="chart-panel">
            <h3>Current read</h3>
            <dl className="metric-list">
              <div>
                <dt>New vs repeat volume</dt>
                <dd>
                  {latest
                    ? `${formatUsd(latest.firstTimeBuyerVolumeUsd, true)} new / ${formatUsd(latest.repeatBuyerVolumeUsd, true)} repeat`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt>New buyer concentration</dt>
                <dd>{latest ? `${formatNumber(latest.firstTimeBuyers)} of ${formatNumber(latest.totalBuyers)} buyers` : "-"}</dd>
              </div>
              <div>
                <dt>Peak new-volume month</dt>
                <dd>{peak ? `${formatMonth(peak.monthStart, true)} (${formatUsd(peak.firstTimeBuyerVolumeUsd, true)})` : "-"}</dd>
              </div>
              <div>
                <dt>Source built</dt>
                <dd>{data ? formatDate(Math.floor(Date.parse(data.summary.lastRefreshed) / 1000)) : "-"}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>

      <section className="table-panel full">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent monthly detail</p>
            <h2>First-time vs repeat buyer mix</h2>
          </div>
          <span>{data ? `${formatNumber(data.summary.uniqueBuyers)} historical buyers` : "0 buyers"}</span>
        </div>

        {!data ? (
          <div className="empty-state">
            <TrendingUp size={22} />
            <span>Loading monthly detail</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="numeric">First-time Volume</th>
                  <th className="numeric">Repeat Volume</th>
                  <th className="numeric">New Share</th>
                  <th className="numeric">New Buyers</th>
                  <th className="numeric">Repeat Buyers</th>
                  <th className="numeric">Total Buys</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row) => (
                  <tr key={row.month}>
                    <td>{formatMonth(row.monthStart, true)}</td>
                    <td className="numeric strong">{formatUsd(row.firstTimeBuyerVolumeUsd)}</td>
                    <td className="numeric">{formatUsd(row.repeatBuyerVolumeUsd)}</td>
                    <td className="numeric strong">{formatShare(row.firstTimeBuyerVolumeSharePct)}</td>
                    <td className="numeric">{formatNumber(row.firstTimeBuyers)}</td>
                    <td className="numeric">{formatNumber(row.repeatBuyers)}</td>
                    <td className="numeric">{formatNumber(row.totalBuys)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function SortHeader({
  children,
  field,
  sort,
  numeric,
  onSort
}: {
  children: React.ReactNode;
  field: keyof typeof HEADER_SORTS;
  sort: SortKey;
  numeric?: boolean;
  onSort: (field: keyof typeof HEADER_SORTS) => void;
}) {
  const direction = getSortDirection(sort, field);
  return (
    <th className={numeric ? "numeric" : undefined}>
      <button
        className={`sort-header ${direction ? "active" : ""}`}
        type="button"
        onClick={() => onSort(field)}
        aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      >
        <span>{children}</span>
        <span className="sort-mark">{direction === "asc" ? "up" : direction === "desc" ? "down" : "sort"}</span>
      </button>
    </th>
  );
}

function SaleSortHeader({
  children,
  field,
  sort,
  numeric,
  onSort
}: {
  children: React.ReactNode;
  field: keyof typeof SALE_HEADER_SORTS;
  sort: SaleSortKey;
  numeric?: boolean;
  onSort: (field: keyof typeof SALE_HEADER_SORTS) => void;
}) {
  const direction = getSaleSortDirection(sort, field);
  return (
    <th className={numeric ? "numeric" : undefined}>
      <button
        className={`sort-header ${direction ? "active" : ""}`}
        type="button"
        onClick={() => onSort(field)}
        aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      >
        <span>{children}</span>
        <span className="sort-mark">{direction === "asc" ? "up" : direction === "desc" ? "down" : "sort"}</span>
      </button>
    </th>
  );
}

function WhaleTable({
  data,
  sort,
  onSort
}: {
  data: WhaleReadyResponse | null;
  sort: SortKey;
  onSort: (field: keyof typeof HEADER_SORTS) => void;
}) {
  if (!data) {
    return (
      <div className="empty-state">
        <SlidersHorizontal size={22} />
        <span>Waiting for wallet index</span>
      </div>
    );
  }

  if (data.rows.length === 0) {
    return (
      <div className="empty-state">
        <Search size={22} />
        <span>No wallets match these filters</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <SortHeader field="wallet" sort={sort} onSort={onSort}>
              Wallet
            </SortHeader>
            <SortHeader field="volume" sort={sort} onSort={onSort} numeric>
              Total Volume
            </SortHeader>
            <SortHeader field="buys" sort={sort} onSort={onSort} numeric>
              Total Buys
            </SortHeader>
            <SortHeader field="bonds" sort={sort} onSort={onSort} numeric>
              Total Bonds
            </SortHeader>
            <SortHeader field="last" sort={sort} onSort={onSort}>
              Last Buy
            </SortHeader>
            <SortHeader field="lastBuyUsd" sort={sort} onSort={onSort} numeric>
              Last Buy $
            </SortHeader>
            <SortHeader field="tier" sort={sort} onSort={onSort}>
              Tier
            </SortHeader>
            <SortHeader field="chains" sort={sort} onSort={onSort}>
              Chains
            </SortHeader>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((wallet) => (
            <tr key={wallet.wallet}>
              <td>#{wallet.rank}</td>
              <td>
                <button className="wallet-link" onClick={() => navigate(`/address/${encodeURIComponent(wallet.wallet)}`)}>
                  <WalletCards size={15} />
                  <span>{shortenAddress(wallet.wallet)}</span>
                </button>
              </td>
              <td className="numeric strong">{formatUsd(wallet.totalVolumeUsd)}</td>
              <td className="numeric">{formatNumber(wallet.totalBuys)}</td>
              <td className="numeric">{formatNumber(wallet.totalBonds)}</td>
              <td>{formatDate(wallet.lastBuyAt)}</td>
              <td className="numeric">{formatUsd(wallet.lastBuyUsd)}</td>
              <td>
                <span className={`tier tier-${wallet.tier ?? "none"}`}>{wallet.tierLabel}</span>
              </td>
              <td>{wallet.chainLabels.join(", ") || "-"}</td>
              <td>
                <a className="plain-icon" href={`https://dashboard.ape.bond/address/${wallet.wallet}`} target="_blank" rel="noreferrer" title="Open original dashboard">
                  <ExternalLink size={16} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartnersPage() {
  const [data, setData] = useState<PartnerListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPartners());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load partners");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const partners = data?.rows ?? [];
    if (!term) return partners;
    return partners.filter(
      (partner) =>
        partner.token.toLowerCase().includes(term) ||
        partner.label.toLowerCase().includes(term) ||
        partner.chainLabel.toLowerCase().includes(term) ||
        partner.topBond?.contractAddress.includes(term)
    );
  }, [data, query]);

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">ApeBond project catalog</p>
          <h1>Partners</h1>
        </div>
        <div className="header-actions">
          <PageTabs active="partners" />
          <button className="icon-button primary" onClick={() => void load()} disabled={loading} title="Refresh partners">
            <RefreshCcw size={16} />
            <span>{loading ? "Loading" : "Refresh"}</span>
          </button>
        </div>
      </header>

      <section className="kpi-strip" aria-label="Partner metrics">
        <div className="kpi">
          <span>Partners</span>
          <strong>{data ? formatNumber(data.summary.partners) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Total volume</span>
          <strong>{data ? formatUsd(data.summary.totalVolumeUsd, true) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Total buys</span>
          <strong>{data ? formatNumber(data.summary.totalBuys) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Bonds</span>
          <strong>{data ? formatNumber(data.summary.uniqueBonds) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Catalog refreshed</span>
          <strong>{data ? new Date(data.summary.lastRefreshed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</strong>
        </div>
      </section>

      <section className="controls partners-controls" aria-label="Partner filters">
        <label className="search-field">
          <span>Partner</span>
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ACN, BANANA, Base..." />
        </label>
      </section>

      {error && (
        <section className="error-band">
          <strong>Could not load partners</strong>
          <span>{error}</span>
        </section>
      )}

      <section className="table-panel full">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Grouped like the ApeBond dashboard</p>
            <h2>Bonds by partner</h2>
          </div>
          <span>{formatNumber(rows.length)} partners</span>
        </div>

        {loading && !data ? (
          <div className="empty-state">
            <Layers3 size={22} />
            <span>Loading partner catalog</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <Search size={22} />
            <span>No partners match this search</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Chain</th>
                  <th className="numeric">Total Volume</th>
                  <th className="numeric">Total Buys</th>
                  <th className="numeric">Bonds</th>
                  <th className="numeric">Active</th>
                  <th className="numeric">Sold Out</th>
                  <th>Last Buy</th>
                  <th>Top Bond</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((partner) => (
                  <tr key={partner.key}>
                    <td>
                      <button className="wallet-link" onClick={() => navigate(partnerPath(partner))}>
                        <Layers3 size={15} />
                        <span>{partner.token}</span>
                      </button>
                    </td>
                    <td>{partner.chainLabel}</td>
                    <td className="numeric strong">{formatUsd(partner.totalVolumeUsd)}</td>
                    <td className="numeric">{formatNumber(partner.totalBuys)}</td>
                    <td className="numeric">{formatNumber(partner.totalBonds)}</td>
                    <td className="numeric">{formatNumber(partner.activeBonds)}</td>
                    <td className="numeric">{formatNumber(partner.soldOutBonds)}</td>
                    <td>{formatDate(partner.lastBuyAt)}</td>
                    <td>
                      {partner.topBond ? (
                        <button className="wallet-link" onClick={() => navigate(bondPath(partner.topBond!.contractAddress))}>
                          <BadgeDollarSign size={15} />
                          <span>{partner.topBond.label}</span>
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function PartnerPage({ chainId, token }: { chainId: string; token: string }) {
  const [detail, setDetail] = useState<PartnerDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("volume_desc");

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetchPartner(chainId, token)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load partner"));
  }, [chainId, token]);

  const walletData = useMemo<WhaleReadyResponse | null>(() => {
    if (!detail) return null;
    return {
      status: "ready",
      scope: "all",
      rows: sortWhaleRows(detail.walletRows, sort),
      totalRows: detail.totalWalletRows,
      summary: detail.summary,
      warnings: detail.warnings
    };
  }, [detail, sort]);

  const handleHeaderSort = (field: keyof typeof HEADER_SORTS) => {
    setSort(nextSortForField(sort, field));
  };

  return (
    <main className="app-shell">
      <header className="page-header compact">
        <div>
          <button className="back-button" onClick={() => navigate("/partners")}>
            <ChevronLeft size={16} />
            Partners
          </button>
          <p className="eyebrow">Partner detail</p>
          <h1>{detail?.partner.label ?? token}</h1>
        </div>
        <div className="header-actions">
          <PageTabs active="partners" />
        </div>
      </header>

      {error && (
        <section className="error-band">
          <strong>Could not load partner</strong>
          <span>{error}</span>
        </section>
      )}

      <KpiStrip summary={detail?.summary ?? null} />

      {detail?.warnings.length ? (
        <section className="progress-band">
          <strong>Partial data</strong>
          <span>{detail.warnings.join(" ")}</span>
        </section>
      ) : null}

      <section className="detail-grid partner-detail-grid">
        <div className="table-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Contracts issued</p>
              <h2>Partner bonds</h2>
            </div>
            <span>{detail ? formatNumber(detail.bonds.length) : "0"} bonds</span>
          </div>
          <BondTable bonds={detail?.bonds ?? null} />
        </div>

        <div className="table-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Wallet Watch</p>
              <h2>Top wallets for this partner</h2>
            </div>
            <span>{detail ? formatNumber(detail.totalWalletRows) : "0"} wallets</span>
          </div>
          <WhaleTable data={walletData} sort={sort} onSort={handleHeaderSort} />
        </div>
      </section>
    </main>
  );
}

function BondPage({ address }: { address: string }) {
  const [detail, setDetail] = useState<BondDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("volume_desc");
  const [saleSort, setSaleSort] = useState<SaleSortKey>("date_desc");

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetchBond(address)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load bond"));
  }, [address]);

  const walletData = useMemo<WhaleReadyResponse | null>(() => {
    if (!detail) return null;
    return {
      status: "ready",
      scope: "all",
      rows: sortWhaleRows(detail.walletRows, sort),
      totalRows: detail.totalWalletRows,
      summary: detail.summary,
      warnings: detail.warnings
    };
  }, [detail, sort]);

  const handleHeaderSort = (field: keyof typeof HEADER_SORTS) => {
    setSort(nextSortForField(sort, field));
  };

  const handleSaleHeaderSort = (field: keyof typeof SALE_HEADER_SORTS) => {
    setSaleSort(nextSaleSortForField(saleSort, field));
  };

  return (
    <main className="app-shell">
      <header className="page-header compact">
        <div>
          <button className="back-button" onClick={() => navigate("/partners")}>
            <ChevronLeft size={16} />
            Partners
          </button>
          <p className="eyebrow">Bond detail</p>
          <h1>{detail?.bond.label ?? shortenAddress(address)}</h1>
        </div>
        <div className="header-actions">
          <PageTabs active="partners" />
          <a className="icon-button primary" href={`https://dashboard.ape.bond/bond/${address}`} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            <span>Original</span>
          </a>
        </div>
      </header>

      {error && (
        <section className="error-band">
          <strong>Could not load bond</strong>
          <span>{error}</span>
        </section>
      )}

      <KpiStrip summary={detail?.summary ?? null} />

      <section className="detail-grid">
        <div className="table-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Wallet Watch</p>
              <h2>Top wallets in this bond</h2>
            </div>
            <span>{detail ? formatNumber(detail.totalWalletRows) : "0"} wallets</span>
          </div>
          <WhaleTable data={walletData} sort={sort} onSort={handleHeaderSort} />
        </div>

        <div className="table-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Bond sales</p>
              <h2>Purchases</h2>
            </div>
            <span>{detail ? formatNumber(detail.sales.length) : "0"} buys</span>
          </div>
          <SalesTable detail={detail} sort={saleSort} onSort={handleSaleHeaderSort} />
        </div>
      </section>
    </main>
  );
}

function BondTable({ bonds }: { bonds: PartnerDetailResponse["bonds"] | null }) {
  if (!bonds) {
    return (
      <div className="empty-state">
        <Boxes size={22} />
        <span>Loading bonds</span>
      </div>
    );
  }

  if (bonds.length === 0) {
    return (
      <div className="empty-state">
        <Search size={22} />
        <span>No bonds found</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Bond</th>
            <th>Contract</th>
            <th className="numeric">Volume</th>
            <th className="numeric">Buys</th>
            <th className="numeric">Sold</th>
            <th>Status</th>
            <th>Last Buy</th>
            <th>Discount</th>
          </tr>
        </thead>
        <tbody>
          {bonds.map((bond) => (
            <tr key={bond.contractAddress}>
              <td>
                <button className="wallet-link" onClick={() => navigate(bondPath(bond.contractAddress))}>
                  <BadgeDollarSign size={15} />
                  <span>{bond.label}</span>
                </button>
              </td>
              <td>{shortenAddress(bond.contractAddress)}</td>
              <td className="numeric strong">{formatUsd(bond.totalVolumeUsd)}</td>
              <td className="numeric">{formatNumber(bond.totalBuys)}</td>
              <td className="numeric">{bond.percentageSold === null ? "-" : `${bond.percentageSold.toFixed(1)}%`}</td>
              <td>
                <span className={`status-pill ${bond.soldOut ? "sold-out" : "active"}`}>{bond.soldOut ? "Sold out" : "Active"}</span>
              </td>
              <td>{formatDate(bond.lastBuyAt)}</td>
              <td>{bond.discountDisplay ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesTable({
  detail,
  sort,
  onSort
}: {
  detail: BondDetailResponse | null;
  sort: SaleSortKey;
  onSort: (field: keyof typeof SALE_HEADER_SORTS) => void;
}) {
  if (!detail) {
    return (
      <div className="empty-state">
        <ArrowDownUp size={22} />
        <span>Loading purchases</span>
      </div>
    );
  }

  if (detail.sales.length === 0) {
    return (
      <div className="empty-state">
        <Search size={22} />
        <span>No sales found for this bond</span>
      </div>
    );
  }

  const rows = sortSales(detail.sales, sort).slice(0, 250);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SaleSortHeader field="wallet" sort={sort} onSort={onSort}>
              Wallet
            </SaleSortHeader>
            <SaleSortHeader field="amount" sort={sort} onSort={onSort} numeric>
              Amount Paid
            </SaleSortHeader>
            <SaleSortHeader field="payout" sort={sort} onSort={onSort} numeric>
              Token Amount
            </SaleSortHeader>
            <SaleSortHeader field="tier" sort={sort} onSort={onSort}>
              Tier
            </SaleSortHeader>
            <SaleSortHeader field="chain" sort={sort} onSort={onSort}>
              Chain
            </SaleSortHeader>
            <SaleSortHeader field="date" sort={sort} onSort={onSort}>
              Sale Date
            </SaleSortHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((sale) => (
            <tr key={sale.key}>
              <td>
                <button className="wallet-link" onClick={() => navigate(`/address/${encodeURIComponent(sale.wallet)}`)}>
                  <WalletCards size={15} />
                  <span>{shortenAddress(sale.wallet)}</span>
                </button>
              </td>
              <td className="numeric strong">{formatUsd(sale.dollarValue)}</td>
              <td className="numeric">{formatNumber(Math.round(sale.payout))}</td>
              <td>{sale.tier === null ? "No tier" : TIER_LABELS[sale.tier] ?? `Tier ${sale.tier}`}</td>
              <td>{sale.chainId ?? "-"}</td>
              <td>{formatDate(sale.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WalletPage({ address }: { address: string }) {
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    fetchWallet(address).then(setWallet).catch((err) => setError(err instanceof Error ? err.message : "Unable to load wallet"));
  }, [address]);

  return (
    <main className="app-shell">
      <header className="page-header compact">
        <div>
          <button className="back-button" onClick={() => navigate("/")}>
            <ChevronLeft size={16} />
            Back
          </button>
          <h1>{shortenAddress(address)}</h1>
        </div>
        <div className="header-actions">
          <PageTabs active="wallets" />
          <a className="icon-button primary" href={`https://dashboard.ape.bond/address/${address}`} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            <span>Original</span>
          </a>
        </div>
      </header>

      {error && (
        <section className="error-band">
          <strong>Could not load wallet</strong>
          <span>{error}</span>
        </section>
      )}

      <section className="kpi-strip">
        <div className="kpi">
          <span>Total volume</span>
          <strong>{wallet ? formatUsd(wallet.summary.totalVolumeUsd, true) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Total buys</span>
          <strong>{wallet ? formatNumber(wallet.summary.totalBuys) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Total bonds</span>
          <strong>{wallet ? formatNumber(wallet.summary.totalBonds) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Last buy</span>
          <strong>{wallet ? formatDate(wallet.summary.lastBuyAt) : "-"}</strong>
        </div>
        <div className="kpi">
          <span>Tier</span>
          <strong>{wallet?.summary.tierLabel ?? "-"}</strong>
        </div>
      </section>

      <section className="table-panel full">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Wallet activity</p>
            <h2>All purchases</h2>
          </div>
        </div>
        {!wallet ? (
          <div className="empty-state">
            <ArrowDownUp size={22} />
            <span>Loading purchases</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bond</th>
                  <th>Bond Address</th>
                  <th>Amount Paid</th>
                  <th>Token Amount</th>
                  <th>Tier</th>
                  <th>Sale Date</th>
                </tr>
              </thead>
              <tbody>
                {wallet.sales.map((sale) => (
                  <tr key={sale.key}>
                    <td>{sale.lp}</td>
                    <td>
                      <button className="wallet-link" onClick={() => navigate(bondPath(sale.contractAddress))}>
                        <BadgeDollarSign size={15} />
                        <span>{shortenAddress(sale.contractAddress)}</span>
                      </button>
                    </td>
                    <td className="numeric strong">{formatUsd(sale.dollarValue)}</td>
                    <td className="numeric">{formatNumber(Math.round(sale.payout))}</td>
                    <td>{sale.tier === null ? "No tier" : TIER_LABELS[sale.tier] ?? `Tier ${sale.tier}`}</td>
                    <td>{formatDate(sale.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const path = usePathname();
  if (path === "/acquisition") return <AcquisitionPage />;
  if (path === "/partners") return <PartnersPage />;
  const partnerMatch = path.match(/^\/partner\/([^/]+)\/([^/]+)$/);
  if (partnerMatch) {
    return <PartnerPage chainId={decodeURIComponent(partnerMatch[1])} token={decodeURIComponent(partnerMatch[2])} />;
  }
  const bondMatch = path.match(/^\/bond\/([^/]+)$/);
  if (bondMatch) return <BondPage address={decodeURIComponent(bondMatch[1]).toLowerCase()} />;
  const walletMatch = path.match(/^\/address\/([^/]+)$/);
  if (walletMatch) return <WalletPage address={decodeURIComponent(walletMatch[1]).toLowerCase()} />;
  return <Dashboard />;
}
