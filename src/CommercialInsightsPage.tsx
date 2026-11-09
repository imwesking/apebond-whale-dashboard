import { ArrowDown, ArrowDownUp, ArrowUp, AlertTriangle, RefreshCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  CommercialInsightsReadyResponse,
  CommercialInsightsResponse,
  CommercialProduct,
  CommercialWalletRow
} from "../server/commercialInsightsTypes";
import { fetchCommercialInsights } from "./commercialInsightsApi";
import { formatNumber, formatUsd } from "./format";
import "./commercial-insights.css";

interface CommercialInsightsPageProps {
  navigation: ReactNode;
  onNavigate: (path: string) => void;
  renderWallet: (wallet: string) => ReactNode;
}

type MetricKey = "volumeUsd" | "buyers" | "purchases" | "averagePurchaseUsd" | "medianPurchaseUsd";
type ProductSortKey = "token" | "volumeUsd" | "previousVolumeUsd" | "changeUsd" | "changePct" | "buyers" | "purchases" | "medianPurchaseUsd" | "largestWalletSharePct";
type Direction = "asc" | "desc";

const METRICS: Array<{ key: MetricKey; label: string; money: boolean }> = [
  { key: "volumeUsd", label: "Sales volume", money: true },
  { key: "buyers", label: "Buying wallets", money: false },
  { key: "purchases", label: "Purchases", money: false },
  { key: "averagePurchaseUsd", label: "Average purchase", money: true },
  { key: "medianPurchaseUsd", label: "Median purchase", money: true }
];

function monthLabel(month: string, short = false): string {
  return new Intl.DateTimeFormat("en-US", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function dateLabel(value: string | number | null, includeTime = false): string {
  if (value === null) return "Not available";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    timeZone: "UTC"
  }).format(date) + (includeTime ? " UTC" : "");
}

function defaultClosedMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

function valueLabel(value: number | null, money = false, compact = false): string {
  if (value === null) return "N/A";
  return money ? formatUsd(value, compact) : formatNumber(value);
}

function shareLabel(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function changeLabel(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "N/A";
  if (previous === 0) return current === 0 ? "N/A" : "From zero";
  const change = (current / previous - 1) * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function changeClass(current: number | null, previous: number | null): string {
  if (current === null || previous === null || current === previous) return "";
  return current > previous ? "positive" : "negative";
}

function Comparison({ value, baseline, label, money }: {
  value: number | null;
  baseline: number | null;
  label: string;
  money: boolean;
}) {
  return (
    <div className="ci-comparison" title={baseline === null ? `No data for ${label}` : `${label}: ${valueLabel(baseline, money)}`}>
      <span className={`ci-change ${changeClass(value, baseline)}`}>{changeLabel(value, baseline)}</span>
      <span>vs {label}{baseline !== null ? ` · ${valueLabel(baseline, money, money && Math.abs(baseline) >= 1000)}` : ""}</span>
    </div>
  );
}

function SalesSummary({ data }: { data: CommercialInsightsReadyResponse }) {
  return (
    <section className="ci-summary" aria-label="Sales performance metrics">
      {METRICS.map(({ key, label, money }) => {
        const value = data.summary[key];
        return (
          <div className="ci-metric" key={key}>
            <span className="ci-metric-label">{label}</span>
            <strong title={valueLabel(value, money)}>{valueLabel(value, money, money && value !== null && value >= 1_000_000)}</strong>
            <Comparison value={value} baseline={data.comparisons.previous?.[key] ?? null} label={monthLabel(data.previousPeriod.month, true)} money={money} />
            <Comparison value={value} baseline={data.comparisons.yearAgo?.[key] ?? null} label={monthLabel(data.yearAgoPeriod.month, true)} money={money} />
          </div>
        );
      })}
    </section>
  );
}

function SalesTrend({ data }: { data: CommercialInsightsReadyResponse }) {
  const rows = data.trend.map((row) => ({
    ...row,
    label: monthLabel(row.month, true),
    newVolume: row.available ? row.newVolumeUsd : null,
    returningVolume: row.available ? row.returningVolumeUsd : null
  }));
  return (
    <section aria-labelledby="ci-trend-title">
      <div className="ci-heading">
        <div>
          <h2 id="ci-trend-title">Sales performance</h2>
          <p>Six closed months · sales volume in USD</p>
        </div>
        <span className="ci-small-note">
          {data.summary.buyers > 0 ? `${(data.summary.purchases / data.summary.buyers).toFixed(2)} purchases per wallet this month` : "No purchases this month"}
        </span>
      </div>
      <div className="ci-chart-legend" aria-hidden="true">
        <span><i className="ci-swatch" />New buyers</span>
        <span><i className="ci-swatch returning" />Returning buyers</span>
      </div>
      <div className="ci-chart" role="img" aria-label="Monthly sales volume split between new and returning buyers. The values are also available in the monthly data table below.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8ded8" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#657168" }} minTickGap={8} />
            <YAxis tickFormatter={(value) => formatUsd(Number(value), true)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#657168" }} width={76} />
            <Tooltip formatter={(value, name) => [formatUsd(Number(value)), name]} contentStyle={{ background: "#fbfcfa", border: "1px solid #d3dbd4", borderRadius: 5, fontSize: 12 }} cursor={{ fill: "#eef2ee" }} />
            <Bar name="Returning buyer volume" dataKey="returningVolume" stackId="volume" fill="#2f6f9f" maxBarSize={66} isAnimationActive={false} />
            <Bar name="New buyer volume" dataKey="newVolume" stackId="volume" fill="#0f7b61" radius={[3, 3, 0, 0]} maxBarSize={66} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="ci-data-table">
        <summary>View monthly data</summary>
        <div className="ci-table-wrap">
          <table className="ci-table">
            <thead><tr><th>Month</th><th className="numeric">New volume</th><th className="numeric">Returning volume</th><th className="numeric">Total</th></tr></thead>
            <tbody>{data.trend.map((row) => (
              <tr key={row.month}>
                <td>{monthLabel(row.month, true)}</td>
                <td className="numeric">{row.available ? formatUsd(row.newVolumeUsd) : "No indexed history"}</td>
                <td className="numeric">{row.available ? formatUsd(row.returningVolumeUsd) : "N/A"}</td>
                <td className="numeric strong">{row.available ? formatUsd(row.volumeUsd) : "N/A"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ProductStatus({ product }: { product: CommercialProduct }) {
  const { soldOut, notSoldOut, unknown } = product.catalogue;
  const statuses = [notSoldOut ? `${formatNumber(notSoldOut)} not marked sold out` : "", soldOut ? `${formatNumber(soldOut)} marked sold out` : "", unknown ? `${formatNumber(unknown)} unknown` : ""].filter(Boolean);
  return <span className="ci-status-text">{statuses.length > 0 ? statuses.join(" · ") : "Status unknown"}</span>;
}

function ProductMovers({ data, onNavigate }: { data: CommercialInsightsReadyResponse; onNavigate: (path: string) => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ProductSortKey; direction: Direction }>({ key: "volumeUsd", direction: "desc" });
  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.products.filter((product) => !term || `${product.token} ${product.chainLabel} ${product.key}`.toLowerCase().includes(term)).sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (left === null && right === null) return a.key.localeCompare(b.key);
      if (left === null) return 1;
      if (right === null) return -1;
      const value = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
      return (sort.direction === "asc" ? value : -value) || a.key.localeCompare(b.key);
    });
  }, [data.products, search, sort]);

  const header = (key: ProductSortKey, label: string, numeric = true) => (
    <th className={numeric ? "numeric" : undefined} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className="ci-sort-button" type="button" onClick={() => setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }))}>
        {label}{sort.key === key ? (sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowDownUp size={11} />}
      </button>
    </th>
  );

  return (
    <section className="ci-section" aria-labelledby="ci-products-title">
      <div className="ci-heading">
        <div><h2 id="ci-products-title">Product movers</h2><p>Partner and chain · includes products with sales only in the previous month</p></div>
        <label className="ci-search"><Search size={15} /><input aria-label="Search products or chains" placeholder="Search product or chain" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      <div className="ci-table-wrap" tabIndex={0} role="region" aria-label="Product performance table">
        <table className="ci-table">
          <thead><tr>
            {header("token", "Product", false)}{header("volumeUsd", "Volume")}{header("previousVolumeUsd", "Previous")}{header("changeUsd", "Change $")}{header("changePct", "Change %")}{header("buyers", "Buyers")}{header("purchases", "Buys")}{header("medianPurchaseUsd", "Median buy")}{header("largestWalletSharePct", "Top wallet")}
            <th>Current bond statuses</th>
          </tr></thead>
          <tbody>{products.map((product) => (
            <tr key={product.key}>
              <td className="ci-product-cell"><button className="ci-product-link" type="button" onClick={() => onNavigate(`/partner/${product.chainId ?? "unknown"}/${encodeURIComponent(product.token)}`)}>{product.token}</button><span className="ci-secondary">{product.chainLabel}</span></td>
              <td className="numeric strong">{formatUsd(product.volumeUsd)}</td>
              <td className="numeric">{valueLabel(product.previousVolumeUsd, true)}</td>
              <td className={`numeric ci-change ${changeClass(product.volumeUsd, product.previousVolumeUsd)}`}>{product.changeUsd === null ? "N/A" : `${product.changeUsd > 0 ? "+" : ""}${formatUsd(product.changeUsd)}`}</td>
              <td className={`numeric ci-change ${changeClass(product.volumeUsd, product.previousVolumeUsd)}`}>{product.changePct === null ? (product.previousVolumeUsd === 0 && product.volumeUsd > 0 ? "From zero" : "N/A") : `${product.changePct > 0 ? "+" : ""}${product.changePct.toFixed(1)}%`}</td>
              <td className="numeric">{formatNumber(product.buyers)}</td><td className="numeric">{formatNumber(product.purchases)}</td>
              <td className="numeric">{valueLabel(product.medianPurchaseUsd, true)}</td><td className="numeric">{shareLabel(product.largestWalletSharePct)}</td>
              <td className="ci-status-cell"><ProductStatus product={product} /></td>
            </tr>
          ))}</tbody>
        </table>
        {products.length === 0 && <div className="ci-empty">{search ? "No products match this search." : "No product sales recorded in either comparison month."}</div>}
      </div>
      <p className="ci-footnote">{formatNumber(products.length)} of {formatNumber(data.products.length)} products · Top wallet = share of that product's monthly volume. Bond statuses describe the current catalogue, not historical availability.</p>
    </section>
  );
}

function BuyerSegments({ data }: { data: CommercialInsightsReadyResponse }) {
  const { summary, buyerSegments } = data;
  return (
    <section className="ci-section" aria-labelledby="ci-segments-title">
      <div className="ci-heading"><div><h2 id="ci-segments-title">Buyer segments</h2><p>Wallet counts and the value behind them</p></div></div>
      <div className="ci-segment-summary">
        <div><span className="ci-small-note">New buyers</span><strong>{formatNumber(summary.newBuyers)}</strong><span className="ci-small-note">{formatUsd(summary.newVolumeUsd)} volume</span></div>
        <div><span className="ci-small-note">Returning buyers</span><strong>{formatNumber(summary.returningBuyers)}</strong><span className="ci-small-note">{formatUsd(summary.returningVolumeUsd)} volume</span></div>
      </div>
      <div className="ci-table-wrap">
        <table className="ci-table">
          <thead><tr><th>Purchase threshold</th><th className="numeric">Wallets</th><th className="numeric">Of buyers</th></tr></thead>
          <tbody>
            {buyerSegments.thresholds.map((row) => <tr key={row.minimumUsd}><td>Any purchase ≥ {formatUsd(row.minimumUsd, true)}</td><td className="numeric strong">{formatNumber(row.wallets)}</td><td className="numeric">{summary.buyers ? shareLabel(row.wallets / summary.buyers * 100) : "N/A"}</td></tr>)}
            <tr><td>Only purchases below $10</td><td className="numeric strong">{formatNumber(buyerSegments.smallOnly.wallets)}</td><td className="numeric">{summary.buyers ? shareLabel(buyerSegments.smallOnly.wallets / summary.buyers * 100) : "N/A"}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="ci-footnote">Threshold rows overlap and should not be added together. Wallets buying only below $10 contributed <strong>{formatUsd(buyerSegments.smallOnly.volumeUsd)}</strong>{summary.volumeUsd > 0 ? ` (${shareLabel(buyerSegments.smallOnly.volumeUsd / summary.volumeUsd * 100)} of sales)` : ""}.</p>
      <p className="ci-footnote">New = first recorded purchase in this month. Returning = first recorded purchase before this month. All purchases by each group are included; a wallet is not necessarily one person.</p>
    </section>
  );
}

function Concentration({ data }: { data: CommercialInsightsReadyResponse }) {
  const rows: Array<[string, number | null]> = [
    ["Largest wallet", data.concentration.top1WalletPct],
    ["Top 5 wallets", data.concentration.top5WalletPct],
    ["Top 10 wallets", data.concentration.top10WalletPct],
    ["Top 3 products", data.concentration.top3ProductsPct]
  ];
  return (
    <section className="ci-section" aria-labelledby="ci-concentration-title">
      <div className="ci-heading"><div><h2 id="ci-concentration-title">Sales concentration</h2><p>Share of {monthLabel(data.month, true)} sales volume</p></div></div>
      <dl className="ci-concentration-list">{rows.map(([label, value]) => (
        <div className="ci-concentration-row" key={label}>
          <dt>{label}</dt><dd>{shareLabel(value)}</dd>
          <div className="ci-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} /></div>
        </div>
      ))}</dl>
      <p className="ci-footnote">A high share means sales depend on fewer wallets or products. These groups overlap; percentages are not additive.</p>
    </section>
  );
}

function WalletTable({ rows, inactive, renderWallet, onNavigate }: {
  rows: CommercialWalletRow[];
  inactive: boolean;
  renderWallet: (wallet: string) => ReactNode;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="ci-table-wrap" tabIndex={0} role="region" aria-label={inactive ? "Inactive repeat buyers table" : "Active buyers table"}>
      <table className="ci-table">
        <thead><tr><th>Wallet</th><th className="numeric">{inactive ? "Prior 12-month volume" : "Month volume"}</th><th className="numeric">Purchases</th>{inactive && <th className="numeric">Months active</th>}<th>Last purchase · UTC</th><th>Preferred products</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.wallet}>
          <td>{renderWallet(row.wallet)}</td><td className="numeric strong">{formatUsd(row.volumeUsd)}</td><td className="numeric">{formatNumber(row.purchases)}</td>{inactive && <td className="numeric">{formatNumber(row.activeMonths)}</td>}<td>{dateLabel(row.lastBuyAt)}</td>
          <td><div className="ci-preferences">{row.preferredProducts.length > 0 ? row.preferredProducts.map((product) => <button key={product.key} className="ci-text-button" type="button" title={`${product.token} · Chain ${product.chainId ?? "unknown"} · ${formatUsd(product.volumeUsd)}`} onClick={() => onNavigate(`/partner/${product.chainId ?? "unknown"}/${encodeURIComponent(product.token)}`)}>{product.token}<span className="ci-secondary">{product.chainId === null ? "Unknown chain" : `Chain ${product.chainId}`}</span></button>) : <span className="ci-small-note">No product history</span>}</div></td>
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <div className="ci-empty">{inactive ? "No inactive repeat buyers meet this lookback definition." : "No buying wallets recorded for this month."}</div>}
    </div>
  );
}

function WalletOpportunities({ data, renderWallet, onNavigate }: {
  data: CommercialInsightsReadyResponse;
  renderWallet: (wallet: string) => ReactNode;
  onNavigate: (path: string) => void;
}) {
  const [tab, setTab] = useState<"inactive" | "current">("inactive");
  const inactive = tab === "inactive";
  const rows = inactive ? data.wallets.inactive : data.wallets.current;
  const total = inactive ? data.wallets.totalInactive : data.wallets.totalCurrent;
  return (
    <section className="ci-section" aria-labelledby="ci-wallets-title">
      <div className="ci-heading"><div><h2 id="ci-wallets-title">Wallet opportunities</h2><p>Understand recent buyers and repeat buyers who did not return</p></div><span className="ci-small-note">Showing {formatNumber(rows.length)} of {formatNumber(total)} · highest volume first</span></div>
      <div className="ci-wallet-tabs" role="group" aria-label="Wallet segment">
        <button type="button" aria-pressed={inactive} onClick={() => setTab("inactive")}>Inactive repeat buyers <span>{formatNumber(data.wallets.totalInactive)}</span></button>
        <button type="button" aria-pressed={!inactive} onClick={() => setTab("current")}>Active buyers <span>{formatNumber(data.wallets.totalCurrent)}</span></button>
      </div>
      <WalletTable rows={rows} inactive={inactive} renderWallet={renderWallet} onNavigate={onNavigate} />
      <p className="ci-footnote">{inactive ? `Bought in at least two distinct months over the previous 12 months (${dateLabel(data.wallets.lookbackStart)}–${dateLabel(data.wallets.lookbackEnd - 1)}, UTC), with no purchase in ${monthLabel(data.month)}. Volume, purchases and preferred products cover that lookback only; previous spending is not a sales forecast.` : `Volume, purchases, last purchase and preferred products cover ${monthLabel(data.month)} only. Open a wallet to inspect its full history.`}</p>
    </section>
  );
}

function LoadingState() {
  return <div className="ci-loading" role="status"><span className="ci-small-note">Loading commercial insights…</span><div className="ci-skeleton-row" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div><div className="ci-skeleton-chart" aria-hidden="true" /></div>;
}

export default function CommercialInsightsPage({ navigation, onNavigate, renderWallet }: CommercialInsightsPageProps) {
  const [requestedMonth, setRequestedMonth] = useState("");
  const [response, setResponse] = useState<CommercialInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  const data = response?.status === "ready" ? response : null;
  const building = response?.status === "building" ? response : null;
  const selectedMonth = requestedMonth || data?.month || defaultClosedMonth();
  const availableMonths = data?.availableMonths.length ? data.availableMonths : [selectedMonth];

  useEffect(() => {
    const requestId = ++sequence.current;
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchCommercialInsights(requestedMonth || undefined, controller.signal);
        if (requestId !== sequence.current || controller.signal.aborted) return;
        setResponse(result);
        if (result.status === "building") poll = setTimeout(() => void load(), 10_000);
      } catch (err) {
        if (requestId !== sequence.current || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load commercial insights.");
      } finally {
        if (requestId === sequence.current && !controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (poll) clearTimeout(poll);
    };
  }, [requestedMonth, reload]);

  const selectMonth = (month: string) => {
    if (month === selectedMonth) return;
    sequence.current += 1;
    setResponse(null);
    setError(null);
    setLoading(true);
    setRequestedMonth(month);
  };

  const qualityMessages = data ? [
    ...(data.quality.failedContracts > 0 ? [`${formatNumber(data.quality.failedContracts)} bond details failed during indexing. Sales totals may be incomplete; the missing volume is unknown.`] : data.quality.partial ? ["The sales index is incomplete. Totals and buyer classifications may be affected."] : []),
    ...(data.quality.stale ? ["The sales index is older than its refresh window. Check the indexed date before using these figures."] : []),
    ...data.quality.warnings
  ].filter((message, index, messages) => messages.indexOf(message) === index) : [];

  return (
    <main className="app-shell commercial-insights-page">
      <header className="page-header">
        <div><p className="eyebrow">ApeBond commercial overview</p><h1>Commercial Insights</h1><p className="ci-subtitle">Sales movement, buyer quality and where to investigate next.</p></div>
        <div className="header-actions">{navigation}</div>
      </header>

      <div className="ci-toolbar">
        <label className="ci-month-control">Closed month<select value={selectedMonth} onChange={(event) => selectMonth(event.target.value)} disabled={!data}><option hidden value="">Choose a month</option>{availableMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
        <p className="ci-period-note">All chains · Calendar months in UTC<br />{data ? `Compared with ${monthLabel(data.previousPeriod.month)} and ${monthLabel(data.yearAgoPeriod.month)}` : "Equal calendar-month comparisons"}</p>
        <button className="icon-button ci-refresh" type="button" onClick={() => setReload((value) => value + 1)} disabled={loading} title="Reload the latest indexed data"><RefreshCcw size={15} /><span>{loading ? "Loading" : "Refresh"}</span></button>
      </div>

      {data && <div className="ci-source-line"><span>Sales indexed {dateLabel(data.quality.salesAsOf, true)}</span><span>USD bond sales volume · not platform revenue or profit</span></div>}
      {error && <div className="ci-notice ci-error" role="alert"><AlertTriangle size={17} /><div><strong>Could not load commercial insights</strong><p>{error}</p><button className="ci-text-button" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div></div>}
      {!response && loading && <LoadingState />}
      {building && <section className="progress-band" aria-live="polite"><div><strong>Building the sales index</strong><span>{formatNumber(building.progress.completed)} / {building.progress.total ? formatNumber(building.progress.total) : "…"} bonds processed{building.progress.failed ? ` · ${formatNumber(building.progress.failed)} failed` : ""}. This page checks again every 10 seconds.</span></div><div className="progress-track"><span style={{ width: `${building.progress.total ? Math.min(100, building.progress.completed / building.progress.total * 100) : 0}%` }} /></div></section>}

      {data && <>
        {qualityMessages.length > 0 && <div className="ci-notice" role="status"><AlertTriangle size={17} /><div>{qualityMessages.map((message) => <p key={message}>{message}</p>)}</div></div>}
        {!data.period.available && <div className="ci-notice"><AlertTriangle size={17} /><p>No indexed history is available for {monthLabel(data.month)}. Missing history should not be interpreted as zero sales.</p></div>}
        {data.period.available && data.summary.purchases === 0 && <div className="ci-notice"><p>No sales recorded for {monthLabel(data.month)}. Previous-month products remain visible for comparison.</p></div>}
        <SalesSummary data={data} />
        <div className="ci-overview">
          <SalesTrend data={data} />
          <aside className="ci-current-read" aria-labelledby="ci-current-title"><h2 id="ci-current-title">Current read</h2>{data.observations.length > 0 ? <ol>{data.observations.slice(0, 3).map((observation) => <li key={observation}>{observation}</li>)}</ol> : <p className="ci-footnote">There is not enough comparable history for a sales readout.</p>}<p className="ci-footnote">Observed changes help prioritize investigation; they do not establish why buyers changed their behavior.</p></aside>
        </div>
        <ProductMovers key={`products-${data.month}`} data={data} onNavigate={onNavigate} />
        <div className="ci-two-columns"><BuyerSegments data={data} /><Concentration data={data} /></div>
        <WalletOpportunities key={`wallets-${data.month}`} data={data} renderWallet={renderWallet} onNavigate={onNavigate} />
        <section className="ci-catalogue" aria-labelledby="ci-catalogue-title">
          <div><h2 id="ci-catalogue-title">Current catalogue context</h2><p>{data.quality.catalogueAsOf ? `Catalogue indexed ${dateLabel(data.quality.catalogueAsOf, true)}. ` : "The current catalogue could not be loaded. Sales insights remain available; product statuses may be unknown. "}Bond statuses describe the current catalogue, not availability during {monthLabel(data.month)}. “Not marked sold out” does not confirm that a bond is currently purchasable. Historical discounts, visits, purchase attempts and campaign attribution are not available in this sales index.</p></div>
        </section>
      </>}
    </main>
  );
}
