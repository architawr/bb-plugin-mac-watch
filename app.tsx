// Mac Watch page: the health of the Mac that runs BB.
// Visual language follows a native macOS system panel: dense rows, thin bars,
// live line charts with a dashed 100% guide, real app icons. Phone first.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { definePluginApp, useBbNavigate, useRealtime, useRpc, type ExperimentalSidebarFooterDisclosureProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import {
  awakeVerdict, formatBytes, formatDuration, formatMinutes, formatRate, ru,
  type Alert, type HistoryPoint, type Proc, type SleepHolder, type Snapshot, type Tone,
} from "./core";
import "./style.css";

type Status = { snapshot: Snapshot | null; alerts: Alert[]; error: string | null; intervalSec: number };
type Range = 1 | 6 | 24;
type History = { points: HistoryPoint[]; bucketMs: number };
type Field = keyof Omit<HistoryPoint, "at">;

// ---------- data ----------

function useMacWatch(range: Range) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);

  const readStatus = useCallback(() => {
    rpc.call("status", null).then((s) => { setStatus(s); setError(null); }, report);
  }, [rpc, report]);
  const readHistory = useCallback(() => {
    rpc.call("history", { hours: range }).then(setHistory, report);
  }, [rpc, range, report]);

  useEffect(readStatus, [readStatus]);
  useEffect(readHistory, [readHistory]);
  // The server publishes after every sample; the timer covers a dropped connection.
  useRealtime("sample", () => { readStatus(); readHistory(); });
  useEffect(() => {
    const timer = setInterval(readStatus, 30_000);
    return () => clearInterval(timer);
  }, [readStatus]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await rpc.call("refresh", null));
      readHistory();
    } catch (cause) {
      report(cause);
    }
  }, [rpc, readHistory, report]);

  return { rpc, status, history, error, refresh };
}

/** Icons of the apps in the lists, fetched once per bundle. */
function useIcons(apps: (string | null)[]) {
  const rpc = useRpc<typeof rpcContract>();
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  const key = apps.filter(Boolean).join("|");
  useEffect(() => {
    const missing = [...new Set(apps.filter((a): a is string => !!a && !asked.current.has(a)))];
    if (missing.length === 0) return;
    for (const a of missing) asked.current.add(a);
    rpc.call("icons", { apps: missing.slice(0, 40) }).then((found) => setIcons((prev) => ({ ...prev, ...found })), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rpc]);
  return icons;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

// ---------- formatting ----------

const clock = (at: number | null | undefined) =>
  at == null ? "—" : new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayTime = (at: number | null | undefined) => {
  if (at == null) return "—";
  const d = new Date(at);
  return new Date().toDateString() === d.toDateString()
    ? `сегодня в ${clock(at)}`
    : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "только что";
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  return `${Math.floor(s / 3600)} ч назад`;
}
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);

// ---------- icons ----------

const glyphs = {
  thermo: <path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z" />,
  chip: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  drive: <><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 12h.01M11 12h6" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  laptop: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx=".5" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  battery: <><rect x="2" y="7" width="17" height="10" rx="2.5" /><path d="M22 11v2" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  alert: <><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 21v-5h-5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3M12 15h5" /></>,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  display: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="M14.5 8.2A3 3 0 1 1 10.8 12" /></>,
  power: <><path d="M12 3v8" /><path d="M6.4 6.6a8 8 0 1 0 11.2 0" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
} satisfies Record<string, ReactNode>;
type GlyphName = keyof typeof glyphs;

function Glyph({ name, size = 16, className, style }: { name: GlyphName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`mw-glyph ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {glyphs[name]}
    </svg>
  );
}

// ---------- building blocks ----------

function Panel({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mw-panel-wrap">
      <div className="mw-panel-label"><span>{label}</span>{action}</div>
      <div className="mw-panel">{children}</div>
    </section>
  );
}

function Sub({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mw-sub">
      <div className="mw-sub-head"><h3>{title}</h3>{action}</div>
      {children}
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className={`mw-tile ${tone ? `mw-tone-${tone}` : ""}`}>
      <div className="mw-tile-label">{icon}{label}</div>
      <div className="mw-tile-value">{value}</div>
    </div>
  );
}

function Row({ label, value, tone, sub }: { label: ReactNode; value: ReactNode; tone?: Tone; sub?: boolean }) {
  return (
    <div className={`mw-row ${sub ? "mw-row-sub" : ""}`}>
      <span className="mw-row-label">{label}</span>
      <span className={`mw-row-value ${tone ? `mw-text-${tone}` : ""}`}>{value}</span>
    </div>
  );
}

function Badge({ tone, children }: { tone: Tone | "muted"; children: ReactNode }) {
  return <span className={`mw-badge mw-badge-${tone}`}><i />{children}</span>;
}

function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="mw-segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Bar({ value, color }: { value: number | null; color: string }) {
  return (
    <span className="mw-bar" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
    </span>
  );
}

// ---------- live chart ----------

type Series = { field: Field; color: string; name: string };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v * 1.05) return m * exp;
  return 10 * exp;
}

/** A thin live chart: dashed guide at the top, gaps where the Mac slept, hover for exact values. */
function LiveChart({ history, series, max, minTop = 0, fill, format, height = 64, unit = 1 }: {
  history: History | null; series: Series[]; max?: number; fill?: boolean; format: (v: number) => string; height?: number;
  /** Lowest scale top, so a calm line does not look like a spike. */
  minTop?: number;
  /** Round the scale in this unit, e.g. 1024 for byte rates. */
  unit?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(
    () => (history?.points ?? []).filter((p) => series.some((s) => p[s.field] != null)),
    [history, series],
  );
  const W = 400;
  const H = height;
  const top = max ?? Math.max(minTop, niceMax(Math.max(0, ...points.flatMap((p) => series.map((s) => p[s.field] ?? 0))) / unit) * unit);
  const from = points[0]?.at ?? 0;
  const to = points.at(-1)?.at ?? 1;
  const x = (at: number) => (to === from ? W : ((at - from) / (to - from)) * W);
  const y = (v: number) => H - 2 - (Math.min(v, top) / top) * (H - 8);
  // Restored history is stored per minute: only a gap of several minutes means the Mac slept.
  const gap = Math.max(history?.bucketMs ?? 15_000, 60_000) * 2.5;

  const paths = series.map((s) => {
    let line = "";
    let area = "";
    let start: number | null = null;
    let prev: HistoryPoint | null = null;
    const close = () => { if (start !== null && prev) area += `L${x(prev.at)},${H}L${start},${H}Z`; };
    for (const p of points) {
      const v = p[s.field];
      if (v == null) { close(); start = null; prev = null; continue; }
      if (!prev || p.at - prev.at > gap) {
        close();
        start = x(p.at);
        // The tiny step draws a dot for a lone sample (e.g. right after waking up).
        line += `M${x(p.at)},${y(v)}h0.01`;
        area += `M${x(p.at)},${H}L${x(p.at)},${y(v)}`;
      } else {
        line += `L${x(p.at)},${y(v)}`;
        area += `L${x(p.at)},${y(v)}`;
      }
      prev = p;
    }
    close();
    return { ...s, line, area };
  });

  const pick = (e: ReactPointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || points.length === 0) return;
    const at = from + ((e.clientX - box.left) / box.width) * (to - from);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.at - at) < Math.abs(points[best]!.at - at)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? points[hover] ?? null : null;

  return (
    <div className="mw-chart-wrap">
    <div className="mw-live-chart" ref={ref} style={{ "--mw-chart-h": `${height}px` } as CSSProperties}
      onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {paths.map((p) => (
            <linearGradient key={p.field} id={`mw-g-${p.field}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={p.color} stopOpacity=".32" />
              <stop offset="1" stopColor={p.color} stopOpacity=".04" />
            </linearGradient>
          ))}
        </defs>
        <line x1="0" x2={W} y1={y(top)} y2={y(top)} className="mw-guide" vectorEffect="non-scaling-stroke" />
        {fill && paths.map((p) => <path key={`a${p.field}`} d={p.area} fill={`url(#mw-g-${p.field})`} />)}
        {paths.map((p) => (
          <path key={`l${p.field}`} d={p.line} fill="none" stroke={p.color} strokeWidth="1.6"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
        {hp && <line x1={x(hp.at)} x2={x(hp.at)} y1="0" y2={H} className="mw-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="mw-guide-label" style={{ top: `${(y(top) / H) * 100}%` }}>{max === 100 ? "100%" : format(top)}</span>
      {hp && (
        <div className="mw-tip" style={{ left: `${(x(hp.at) / W) * 100}%` }}>
          <span>{clock(hp.at)}</span>
          {series.map((s) => <strong key={s.field} style={{ color: s.color }}>{hp[s.field] == null ? "—" : format(hp[s.field]!)}</strong>)}
        </div>
      )}
      {points.length < 2 && <span className="mw-chart-wait">Копится история…</span>}
    </div>
    {points.length >= 2 && (
      <div className="mw-chart-axis" aria-hidden="true"><span>{clock(from)}</span><span>сейчас</span></div>
    )}
    </div>
  );
}

function UsageRow({ label, badge, value, text, color, open, onToggle, children }: {
  label: string; badge?: ReactNode; value: number | null; text: ReactNode; color: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="mw-usage">
      <button type="button" className="mw-usage-row" aria-expanded={open} onClick={onToggle}>
        <Glyph name="chevron" size={13} className={`mw-chevron ${open ? "mw-chevron-open" : ""}`} />
        <span className="mw-usage-label">{label}{badge}</span>
        {value === null ? <span /> : <Bar value={value} color={color} />}
        <span className="mw-usage-value">{text}</span>
      </button>
      {open && <div className="mw-usage-body">{children}</div>}
    </div>
  );
}

// ---------- sections ----------

function Header({ s, intervalSec, now, onPower }: { s: Snapshot | null; intervalSec: number; now: number; onPower: () => void }) {
  const age = s ? now - s.at : null;
  const stale = age === null || age > intervalSec * 4000;
  return (
    <header className="mw-header">
      <div className="mw-header-text">
        <h1>{s?.host.name ?? "Mac"}</h1>
        <p>
          <span className={`mw-dot ${stale ? "mw-dot-warn" : "mw-dot-good"}`} />
          {age === null ? "Нет данных" : stale ? `Нет связи · ${ago(age)}` : `Онлайн · ${ago(age)}`}
          {s && <span className="mw-header-extra">· {s.host.os} · работает {formatDuration(s.host.uptimeSec)}</span>}
        </p>
      </div>
      <button type="button" className="mw-power-button" aria-label="Питание: экран, сон, выключение" onClick={onPower} disabled={!s}>
        <Glyph name="power" size={18} />
      </button>
    </header>
  );
}

function Alerts({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mw-alerts" role="status">
      {alerts.map((a) => (
        <div key={a.id} className={`mw-alert mw-tone-${a.tone}`}>
          <Glyph name="alert" size={16} />
          <div><strong>{a.title}</strong><span>{a.detail}</span></div>
        </div>
      ))}
    </div>
  );
}

/** "Is everything fine?" in one card: the answer, then the problems if any. */
function Verdict({ s, alerts }: { s: Snapshot; alerts: Alert[] }) {
  const awake = awakeVerdict(s.sleep);
  const p = s.power;
  if (alerts.length > 0) return <Alerts alerts={alerts} />;
  return (
    <div className="mw-ok">
      <span className="mw-ok-icon"><Glyph name="check" size={16} /></span>
      <div>
        <strong>Всё в порядке</strong>
        <span>{awake.title}{p ? ` · ${p.source === "ac" ? "от сети" : "от батареи"}` : ""}</span>
      </div>
    </div>
  );
}

type Tab = "overview" | "system" | "power" | "apps";

function KpiTile({ label, value, unit, note, tone, bar, color, onClick }: {
  label: string; value: ReactNode; unit?: string; note?: ReactNode; tone?: Tone; bar?: number | null; color: string; onClick: () => void;
}) {
  return (
    <button type="button" className={`mw-kpi ${tone ? `mw-tone-${tone}` : ""}`} onClick={onClick}>
      <span className="mw-kpi-label">{label}<Glyph name="chevron" size={12} /></span>
      <span className="mw-kpi-value">{value}{unit && <small>{unit}</small>}</span>
      {bar !== undefined && <Bar value={bar} color={color} />}
      {note && <span className="mw-kpi-note">{note}</span>}
    </button>
  );
}

function KpiGrid({ s, go, wide }: { s: Snapshot; go: (t: Tab) => void; wide?: boolean }) {
  const m = s.memory;
  const memPct = m ? (m.used / m.total) * 100 : null;
  const p = s.power;
  const soc = s.temps?.soc ?? null;
  const pressure = m?.pressure;
  return (
    <div className={`mw-kpis ${wide ? "mw-kpis-wide" : ""}`}>
      <KpiTile label="Процессор" value={s.cpu.usage == null ? "—" : Math.round(s.cpu.usage)} unit="%" bar={s.cpu.usage}
        color="var(--mw-blue)" note={`нагрузка ${ru(s.cpu.load[0], 1)}`} onClick={() => go("system")} />
      <KpiTile label="Память" value={memPct == null ? "—" : Math.round(memPct)} unit="%" bar={memPct} color="var(--mw-teal)"
        tone={pressure === "critical" ? "bad" : pressure === "warn" ? "warn" : undefined}
        note={pressure === "critical" ? "давление критическое" : pressure === "warn" ? "давление высокое" : "давление в норме"}
        onClick={() => go("system")} />
      <KpiTile label="Температура" value={soc == null ? "—" : Math.round(soc)} unit="°C" color="var(--mw-orange)"
        bar={soc == null ? null : Math.min(100, soc)} tone={tempTone(soc, 90, 100)}
        note={(s.thermalPressure ?? 0) >= 2 ? "macOS тормозит процессор" : "процессор"} onClick={() => go("overview")} />
      <KpiTile label="Питание" value={p?.percent ?? "—"} unit="%" color="var(--mw-green)" bar={p?.percent ?? null}
        tone={p?.source === "battery" ? ((p.percent ?? 100) <= 20 ? "bad" : "warn") : undefined}
        note={!p ? "—" : `${p.source === "ac" ? "сеть" : "батарея"}${p.systemWatts != null ? ` · ${ru(p.systemWatts, 0)} Вт` : ""}`}
        onClick={() => go("power")} />
    </div>
  );
}

/** A one-line summary that opens into details; opens by itself when something is wrong. */
function Disclosure({ title, badge, problem, children }: { title: string; badge: ReactNode; problem: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(problem);
  useEffect(() => { if (problem) setOpen(true); }, [problem]);
  return (
    <div className="mw-disclosure">
      <button type="button" className="mw-disclosure-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        {badge}
        <Glyph name="chevron" size={13} className={`mw-chevron ${open ? "mw-chevron-open" : ""}`} />
      </button>
      {open && <div className="mw-disclosure-body">{children}</div>}
    </div>
  );
}

/** Human names for processes that only have a bundle id. */
const FRIENDLY: Record<string, string> = {
  "com.apple.Virtualization.VirtualMachine": "Виртуальная машина",
  "com.apple.WebKit.WebContent": "Safari: вкладки",
  "com.apple.WebKit.GPU": "Safari: графика",
  "com.apple.WebKit.Networking": "Safari: сеть",
  "com.apple.quicklook.ThumbnailsAgent": "Миниатюры Quick Look",
  "com.apple.SafariPlatformSupport.Helper": "Safari: помощник",
};
const displayName = (name: string) =>
  FRIENDLY[name] ?? (name.startsWith("com.apple.") ? name.split(".").slice(2).join(" ") : name);

function SystemPanel({ s, history, range, setRange }: { s: Snapshot; history: History | null; range: Range; setRange: (r: Range) => void }) {
  const [open, setOpen] = useState({ cpu: true, memory: true, network: true });
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const m = s.memory;
  const d = s.disk;
  const pressure = m?.pressure ?? null;
  const pressureBadge = pressure === "critical" ? <Badge tone="bad">Критическое</Badge>
    : pressure === "warn" ? <Badge tone="warn">Высокое</Badge>
    : pressure === "normal" ? <Badge tone="good">Норма</Badge> : <Badge tone="muted">—</Badge>;

  return (
    <Panel label="Система" action={
      <Segmented label="Период графиков" value={range} onChange={setRange}
        options={[{ value: 1, label: "1 ч" }, { value: 6, label: "6 ч" }, { value: 24, label: "24 ч" }]} />
    }>
      <Sub title="Нагрузка">
        <UsageRow label="CPU" value={s.cpu.usage} text={pct(s.cpu.usage)} color="var(--mw-blue)" open={open.cpu} onToggle={() => toggle("cpu")}>
          <LiveChart history={history} series={[{ field: "cpu", color: "var(--mw-blue)", name: "CPU" }]} max={100} format={(v) => `${ru(v, 0)}%`} />
          <div className="mw-chips">
            <span>Нагрузка <b>{ru(s.cpu.load[0], 2)}</b></span>
            <span>5 мин <b>{ru(s.cpu.load[1], 2)}</b></span>
            <span>15 мин <b>{ru(s.cpu.load[2], 2)}</b></span>
            <span>Ядер <b>{s.host.cores}</b></span>
          </div>
        </UsageRow>
        <UsageRow label="Сеть" value={null} color="var(--mw-cyan)" open={open.network} onToggle={() => toggle("network")}
          text={<span className="mw-net"><Glyph name="arrowDown" size={11} />{formatRate(s.network?.rxBps)}<Glyph name="arrowUp" size={11} />{formatRate(s.network?.txBps)}</span>}>
          <LiveChart history={history} format={formatRate} unit={1024} minTop={1024 * 1024}
            series={[{ field: "rx", color: "var(--mw-cyan)", name: "Входящий" }, { field: "tx", color: "var(--mw-pink)", name: "Исходящий" }]} />
        </UsageRow>
      </Sub>

      <Sub title="Память">
        <UsageRow label="Давление" badge={pressureBadge} value={null} color="var(--mw-teal)" open={open.memory} onToggle={() => toggle("memory")}
          text={m ? `${formatBytes(m.used, 2)} / ${formatBytes(m.total, 0)}` : "—"}>
          {m && (
            <div className="mw-rows-indent">
              <Row sub label="Приложения" value={formatBytes(m.app, 2)} />
              <Row sub label="Wired" value={formatBytes(m.wired, 2)} />
              <Row sub label="Сжато" value={formatBytes(m.compressed, 2)} />
              <Row sub label="Кэш файлов" value={formatBytes(m.cached, 2)} />
              <Row sub label="Своп" value={formatBytes(m.swapUsed, 2)} />
            </div>
          )}
          <LiveChart history={history} fill max={100} format={(v) => `${ru(v, 0)}%`}
            series={[{ field: "memory", color: "var(--mw-teal)", name: "Память" }]} />
        </UsageRow>
      </Sub>

      <Sub title="Диск">
        <div className="mw-usage-row mw-usage-static">
          <span className="mw-usage-label">Macintosh HD</span>
          <Bar value={d ? (d.used / d.total) * 100 : null} color="var(--mw-orange)" />
          <span className="mw-usage-value">{d ? `${formatBytes(d.free, 0)} свободно` : "—"}</span>
        </div>
      </Sub>
    </Panel>
  );
}

const SYSTEM_PROCS = new Set([
  "powerd", "sharingd", "coreaudiod", "WindowServer", "backupd", "useractivityd", "bluetoothd", "mds", "mds_stores",
  "nsurlsessiond", "softwareupdated", "apsd", "cloudd", "airportd", "locationd", "runningboardd",
]);

function PowerPanel({ s, history }: { s: Snapshot; history: History | null }) {
  const sl = s.sleep;
  const verdict = awakeVerdict(sl);
  const p = s.power;
  const [apps, system] = useMemo(() => {
    const byProcess = new Map<string, { process: string; display: boolean; reasons: string[] }>();
    for (const h of sl?.holders ?? ([] as SleepHolder[])) {
      const e = byProcess.get(h.process) ?? { process: h.process, display: false, reasons: [] };
      if (h.type.includes("Display")) e.display = true;
      if (h.name && !e.reasons.includes(h.name)) e.reasons.push(h.name);
      byProcess.set(h.process, e);
    }
    const all = [...byProcess.values()];
    return [all.filter((e) => !SYSTEM_PROCS.has(e.process)), all.filter((e) => SYSTEM_PROCS.has(e.process))];
  }, [sl]);

  const drain = p?.source === "ac" && (p.batteryWatts ?? 0) < -0.5;
  const battery = !p ? "—"
    : p.charging ? `Заряжается${p.minutesToFull ? `, ещё ${formatMinutes(p.minutesToFull)}` : ""}`
    : p.source === "battery" ? (p.minutesToEmpty ? `Хватит на ${formatMinutes(p.minutesToEmpty)}` : "Разряжается")
    : drain ? `Разряжается, ${ru(Math.abs(p.batteryWatts!), 1)} Вт`
    : p.fullyCharged ? "Заряжена" : "Не заряжается";

  return (
    <Panel label="Сон и питание">
      <Sub title="Бодрствование" action={<Badge tone={verdict.tone}>{verdict.tone === "good" ? "Не уснёт" : verdict.tone === "warn" ? "Под вопросом" : "Уснёт"}</Badge>}>
        <div className={`mw-verdict mw-tone-${verdict.tone}`}>
          <Glyph name={verdict.tone === "bad" ? "moon" : "sun"} size={18} />
          <div><strong>{verdict.title}</strong><span>{verdict.detail}</span></div>
        </div>
        <Row label="Крышка" value={sl?.lidClosed == null ? "—" : sl.lidClosed ? "Закрыта" : "Открыта"} />
        <Row label="Сон в системе" value={sl?.sleepDisabled ? "Запрещён" : "Разрешён"} tone={sl?.sleepDisabled ? "good" : undefined} />
        <Row label="Сон от бездействия"
          value={sl?.idleSleepPrevented ? "Заблокирован" : sl?.idleSleepMinutes ? `Через ${sl.idleSleepMinutes} мин` : "Выключен"}
          tone={sl?.idleSleepPrevented || !sl?.idleSleepMinutes ? "good" : "warn"} />
        <Row label="Последний сон" value={dayTime(s.host.lastSleepAt)} />
        <Row label="Пробуждение" value={dayTime(s.host.lastWakeAt)} />
        {apps.length + system.length > 0 && (
          <div className="mw-holders">
            <div className="mw-caption">Не дают уснуть</div>
            {apps.map((e) => (
              <div key={e.process} className="mw-holder">
                <span className="mw-letter">{e.process.slice(0, 1).toUpperCase()}</span>
                <div><strong>{e.process}{e.display && <em> · и экран</em>}</strong><span>{e.reasons.join(" · ")}</span></div>
              </div>
            ))}
          </div>
        )}
      </Sub>

      <Sub title="Питание">
        <div className="mw-tiles">
          <Tile icon={<Glyph name="battery" size={15} />} label="Батарея"
            tone={p?.source === "battery" && (p.percent ?? 100) <= 20 ? "bad" : undefined}
            value={<>{p?.percent ?? "—"}<small>%</small>{p?.source === "ac" && <Glyph name="bolt" size={15} className="mw-bolt" />}</>} />
          <Tile icon={<Glyph name="bolt" size={15} />} label="Потребление"
            value={<>{p?.systemWatts == null ? "—" : ru(p.systemWatts, 1)}<small>Вт</small></>} />
        </div>
        <Row label="Источник" value={!p ? "—" : p.source === "ac" ? `Сеть${p.adapterWatts ? `, адаптер ${p.adapterWatts} Вт` : ""}` : "Батарея"} />
        <Row label="Батарея" value={battery} tone={drain || (p?.source === "battery" && (p.percent ?? 100) <= 20) ? "warn" : undefined} />
        <LiveChart history={history} fill minTop={10} format={(v) => `${ru(v, 0)} Вт`}
          series={[{ field: "watts", color: "var(--mw-green)", name: "Ватты" }]} />
      </Sub>
    </Panel>
  );
}

function AppsPanel({ top, limit = 6 }: { top: Snapshot["top"]; limit?: number }) {
  const [by, setBy] = useState<"memory" | "cpu">("memory");
  const [all, setAll] = useState(false);
  const full: Proc[] = top[by];
  const list = all ? full : full.slice(0, limit);
  const icons = useIcons([...top.memory, ...top.cpu].map((p) => p.app));
  return (
    <Panel label="Приложения" action={
      <Segmented label="Сортировка" value={by} onChange={setBy}
        options={[{ value: "memory", label: "Память" }, { value: "cpu", label: "CPU" }]} />
    }>
      <div className="mw-sub">
        {list.length === 0 ? <p className="mw-caption">Нет данных о процессах</p> : (
          <ol className="mw-apps">
            {list.map((p) => {
              const icon = p.app ? icons[p.app] : null;
              return (
                <li key={p.name}>
                  {icon ? <img src={icon} alt="" className="mw-app-icon" />
                    : p.app ? <span className="mw-letter mw-app-icon">{p.name.slice(0, 1).toUpperCase()}</span>
                    : <span className="mw-app-icon mw-app-exec"><Glyph name="terminal" size={14} /></span>}
                  <span className="mw-app-name" title={p.name}>{displayName(p.name)}</span>
                  <span className="mw-app-value">{by === "cpu" ? `${ru(p.cpu, 1)}%` : formatBytes(p.memory, p.memory >= 1024 ** 3 ? 2 : 1)}</span>
                </li>
              );
            })}
          </ol>
        )}
        {full.length > limit && (
          <button type="button" className="mw-more" onClick={() => setAll((a) => !a)}>
            {all ? "Свернуть" : `Показать все (${full.length})`}
          </button>
        )}
      </div>
    </Panel>
  );
}

// ---------- safety ----------

type SafetyStatus = {
  notify: boolean;
  quiet: string;
  lastPush: { at: number; title: string; channels: string[] } | null;
};

const PRESSURE_LABEL = ["Норма", "Умеренное", "Высокое", "Критическое", "Критическое"] as const;
const tempTone = (v: number | null | undefined, warn: number, bad: number): Tone | undefined =>
  v == null ? undefined : v >= bad ? "bad" : v >= warn ? "warn" : undefined;
const deg = (v: number | null | undefined) => (v == null ? "—" : ru(v, 0));

function useSafety() {
  const rpc = useRpc<typeof rpcContract>();
  const [safety, setSafety] = useState<SafetyStatus | null>(null);
  const read = useCallback(() => { rpc.call("safety_status", null).then(setSafety, () => undefined); }, [rpc]);
  useEffect(read, [read]);
  return { rpc, safety, read };
}

function TempsSection({ s, history, compact }: { s: Snapshot; history: History | null; compact?: boolean }) {
  const t = s.temps;
  const pressure = s.thermalPressure;
  return (
    <Sub title="Температуры" action={pressure == null ? undefined : (
      <Badge tone={pressure >= 3 ? "bad" : pressure >= 2 ? "warn" : "good"}>{PRESSURE_LABEL[pressure] ?? String(pressure)}</Badge>
    )}>
      <div className={`mw-tiles ${compact ? "" : "mw-tiles-3"}`}>
        {!compact && <Tile icon={<Glyph name="chip" size={14} />} label="Процессор" tone={tempTone(t?.soc, 90, 100)} value={<>{deg(t?.soc)}<small>°C</small></>} />}
        <Tile icon={<Glyph name="drive" size={14} />} label="SSD" tone={tempTone(t?.ssd, 60, 70)} value={<>{deg(t?.ssd)}<small>°C</small></>} />
        <Tile icon={<Glyph name="battery" size={14} />} label="Батарея" tone={tempTone(t?.battery ?? s.power?.temperatureC, 40, 50)}
          value={<>{deg(t?.battery ?? s.power?.temperatureC)}<small>°C</small></>} />
      </div>
      <LiveChart history={history} format={(v) => `${ru(v, 0)} °C`} minTop={60}
        series={[{ field: "soc", color: "var(--mw-orange)", name: "Процессор" }]} />
    </Sub>
  );
}

function HealthSection({ s }: { s: Snapshot }) {
  const bs = s.batterySafety;
  const panic = s.panics?.[0];
  const batteryBad = !!bs && (bs.permanentFailure !== 0 || (!!bs.condition && bs.condition !== "Normal") || (bs.cellSpreadMv ?? 0) >= 100);
  const systemBad = (!!s.disk?.smart && s.disk.smart !== "Verified") || !!panic;
  return (
    <Sub title="Здоровье">
      <Disclosure title="Батарея" problem={batteryBad}
        badge={<Badge tone={batteryBad ? "warn" : "good"}>{batteryBad ? "Внимание" : "Исправна"}</Badge>}>
        <Row label="Неисправность" value={!bs ? "—" : bs.permanentFailure === 0 ? "Нет" : `Код ${bs.permanentFailure}`}
          tone={bs && bs.permanentFailure !== 0 ? "bad" : undefined} />
        <Row label="Состояние" value={!bs?.condition ? "—" : bs.condition === "Normal" ? "Норма" : bs.condition}
          tone={bs?.condition && bs.condition !== "Normal" ? "warn" : undefined} />
        <Row label="Разброс ячеек" value={bs?.cellSpreadMv == null ? "—" : `${bs.cellSpreadMv} мВ`}
          tone={(bs?.cellSpreadMv ?? 0) >= 200 ? "bad" : (bs?.cellSpreadMv ?? 0) >= 100 ? "warn" : undefined} />
        <Row label="Перегрев при зарядке" value={bs?.thermallyLimitedSec == null ? "—" : bs.thermallyLimitedSec === 0 ? "Не было" : formatDuration(bs.thermallyLimitedSec)} />
        <Row label="Пик температуры" value={bs?.lifetimeMaxC == null ? "—" : `${bs.lifetimeMaxC} °C`} />
        <Row label="Ёмкость" value={s.power?.healthPct != null ? `${s.power.healthPct}%` : "—"} />
        <Row label="Циклы" value={s.power?.cycles ?? "—"} />
      </Disclosure>
      <Disclosure title="Диск и стабильность" problem={systemBad}
        badge={<Badge tone={systemBad ? "warn" : "good"}>{systemBad ? "Внимание" : "В порядке"}</Badge>}>
        <Row label="SSD (SMART)" value={!s.disk?.smart ? "—" : s.disk.smart === "Verified" ? "В порядке" : s.disk.smart}
          tone={s.disk?.smart && s.disk.smart !== "Verified" ? "bad" : undefined} />
        <Row label="Kernel panic, 7 дней" value={panic ? `${s.panics.length}, последний ${dayTime(panic)}` : "Не было"}
          tone={panic ? "warn" : undefined} />
      </Disclosure>
    </Sub>
  );
}

function NotifySection() {
  const { rpc, safety } = useSafety();
  const [testing, setTesting] = useState<string | null>(null);
  return (
    <Sub title="Уведомления" action={<Badge tone={safety?.notify ? "good" : "muted"}>{!safety ? "—" : safety.notify ? "Включены" : "Выключены"}</Badge>}>
      <div className="mw-inline-actions">
        <button type="button" className="mw-btn mw-btn-small" disabled={testing === "…"}
          onClick={async () => {
            setTesting("…");
            try {
              const r = await rpc.call("test_push", null);
              setTesting(r.channels.length ? "Отправлено" : "Не доставлено");
            } catch (e) { setTesting(e instanceof Error ? e.message : String(e)); }
          }}>
          <Glyph name="bell" size={14} />Проверить пуш
        </button>
        {testing && testing !== "…" && <span className="mw-caption">{testing}</span>}
      </div>
      <p className="mw-caption mw-caption-quiet">
        {safety?.quiet ? `Тихие часы ${safety.quiet.replace("-", "–")}: ночью приходят только критичные уведомления, остальные — после 9 утра.` : "Тихие часы выключены: уведомления приходят круглосуточно."}
        {" "}Приходят только тревоги: перегрев, батарея ниже 20%, память, диск, сбой накопителя или батареи.
      </p>
    </Sub>
  );
}

function SafetyPanel({ s, history }: { s: Snapshot; history: History | null }) {
  return (
    <Panel label="Безопасность">
      <TempsSection s={s} history={history} />
      <HealthSection s={s} />
      <NotifySection />
    </Panel>
  );
}

// ---------- power controls ----------

type PowerStatus = {
  privileges: { toggleSleep: boolean; wake: boolean; shutdown: boolean };
  pending: { at: number; restoreSleepDisabled: boolean; wakeHours: number | null } | null;
  note: { at: number; text: string } | null;
  installCommand: string;
};
type Action = "sleep" | "shutdown";
const WAKE_OPTIONS = [
  { value: 0, label: "Без таймера" },
  { value: 1, label: "1 ч" },
  { value: 4, label: "4 ч" },
  { value: 8, label: "8 ч" },
] as const;

function usePower() {
  const rpc = useRpc<typeof rpcContract>();
  const [power, setPower] = useState<PowerStatus | null>(null);
  const read = useCallback(() => { rpc.call("power_status", null).then(setPower, () => undefined); }, [rpc]);
  useEffect(read, [read]);
  useEffect(() => {
    const timer = setInterval(read, 30_000);
    return () => clearInterval(timer);
  }, [read]);
  return { rpc, power, read };
}

function SetupHint({ command, need }: { command: string; need: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mw-setup">
      <p><strong>{need}</strong> Один раз выполните в Терминале на Маке или по SSH. Скрипт спросит пароль администратора и разрешит без пароля только эти команды: <code>pmset disablesleep</code>, <code>pmset relative wake</code> и <code>shutdown -h now</code>.</p>
      <div className="mw-code">
        <code>{command}</code>
        <button type="button" className="mw-icon-button" aria-label="Скопировать команду"
          onClick={() => { void navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          <Glyph name={copied ? "check" : "copy"} size={14} />
        </button>
      </div>
    </div>
  );
}

function ConfirmSheet({ action, s, power, onClose, onDone }: {
  action: Action; s: Snapshot; power: PowerStatus; onClose: () => void; onDone: (text: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [wake, setWake] = useState<0 | 1 | 4 | 8>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = power.privileges;
  const sleepBlocked = action === "sleep" && !!s.sleep?.sleepDisabled && !p.toggleSleep;
  const wakeBlocked = action === "sleep" && wake !== 0 && !p.wake;
  const shutdownBlocked = action === "shutdown" && !p.shutdown;
  const blocked = sleepBlocked || wakeBlocked || shutdownBlocked;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (action === "sleep") {
        await rpc.call("sleep", { wakeHours: wake === 0 ? null : wake });
        onDone(wake ? `Мак засыпает и проснётся через ${wake} ч.` : "Мак засыпает. Разбудить его можно только на месте.");
      } else {
        await rpc.call("shutdown", { confirm: "shutdown" });
        onDone("Мак выключается. Включить его можно кнопкой питания.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mw-sheet-backdrop" onClick={onClose}>
      <div className="mw-sheet" role="dialog" aria-modal="true" aria-labelledby="mw-sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className={`mw-sheet-icon ${action === "shutdown" ? "mw-tone-bad" : ""}`}><Glyph name={action === "sleep" ? "moon" : "power"} size={22} /></div>
        <h2 id="mw-sheet-title">{action === "sleep" ? "Усыпить Мак?" : "Выключить Мак?"}</h2>
        {action === "sleep" ? (
          <>
            <p>BB станет недоступен. Удалённо Мак не разбудить: только открыть крышку, нажать клавишу или поставить таймер.</p>
            <Segmented label="Проснуться через" value={wake} onChange={setWake} options={[...WAKE_OPTIONS]} />
            {s.sleep?.sleepDisabled && p.toggleSleep && (
              <p className="mw-sheet-note">Сейчас сон запрещён системно. На время сна плагин снимет запрет, а после настоящего пробуждения вернёт его, если приложение всё ещё держит Мак бодрым.</p>
            )}
          </>
        ) : (
          <p>Мак выключится полностью. Включить его можно только кнопкой питания на самом Маке. Несохранённые данные в открытых приложениях пропадут.</p>
        )}
        {sleepBlocked && <SetupHint command={power.installCommand} need="Сон сейчас запрещён системно, а снять запрет без пароля нельзя." />}
        {wakeBlocked && <SetupHint command={power.installCommand} need="Для таймера пробуждения нужно правило sudo." />}
        {shutdownBlocked && <SetupHint command={power.installCommand} need="Для выключения нужно правило sudo." />}
        {error && <p role="alert" className="mw-error">{error}</p>}
        <div className="mw-sheet-actions">
          <button type="button" className="mw-btn" onClick={onClose}>Отмена</button>
          <button type="button" className={`mw-btn ${action === "shutdown" ? "mw-btn-danger" : "mw-btn-primary"}`} disabled={busy || blocked} onClick={go}>
            {busy ? "Отправляю…" : action === "sleep" ? "Усыпить" : "Выключить"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The power menu: a sheet from the bottom, within thumb reach. */
function PowerMenu({ s, onClose, onNote }: { s: Snapshot; onClose: () => void; onNote: (text: string) => void }) {
  const { rpc, power, read } = usePower();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (confirm && power) {
    return <ConfirmSheet action={confirm} s={s} power={power} onClose={onClose} onDone={(text) => { onNote(text); read(); onClose(); }} />;
  }
  return (
    <div className="mw-sheet-backdrop" onClick={onClose}>
      <div className="mw-sheet mw-menu" role="dialog" aria-modal="true" aria-label="Питание" onClick={(e) => e.stopPropagation()}>
        <div className="mw-sheet-grip" />
        <button type="button" className="mw-menu-item" disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await rpc.call("display_off", null); onNote("Экран погашен."); } catch (e) { onNote(e instanceof Error ? e.message : String(e)); }
            onClose();
          }}>
          <span className="mw-menu-icon"><Glyph name="display" size={18} /></span>
          <span><strong>Погасить экран</strong><small>Сразу, Мак продолжит работать</small></span>
        </button>
        <button type="button" className="mw-menu-item" disabled={!power} onClick={() => setConfirm("sleep")}>
          <span className="mw-menu-icon"><Glyph name="moon" size={18} /></span>
          <span><strong>Усыпить…</strong><small>BB станет недоступен</small></span>
        </button>
        <button type="button" className="mw-menu-item mw-menu-danger" disabled={!power} onClick={() => setConfirm("shutdown")}>
          <span className="mw-menu-icon"><Glyph name="power" size={18} /></span>
          <span><strong>Выключить…</strong><small>Включить можно только кнопкой</small></span>
        </button>
        <button type="button" className="mw-btn mw-menu-cancel" onClick={onClose}>Отмена</button>
      </div>
    </div>
  );
}

/**
 * Compact (tabbed) layout whenever the plugin's own pane is narrower than two
 * comfortable columns: on a phone, and on a desktop squeezed by side panels.
 */
function useCompact(ref: React.RefObject<HTMLDivElement | null>, threshold = 860) {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < threshold);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCompact(el.clientWidth < threshold);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, threshold]);
  return compact;
}

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Обзор" },
  { value: "system", label: "Система" },
  { value: "power", label: "Питание" },
  { value: "apps", label: "Приложения" },
];

// ---------- page ----------

function MacWatchPage() {
  const [range, setRange] = useState<Range>(1);
  const { status, history, error } = useMacWatch(range);
  const now = useNow();

  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem("mac-watch-tab") as Tab | null) ?? "overview");
  const scroller = useRef<HTMLDivElement>(null);
  const narrow = useCompact(scroller);
  const setTab = (t: Tab) => {
    setTabState(t);
    localStorage.setItem("mac-watch-tab", t);
    scroller.current?.scrollTo({ top: 0 });
  };
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<{ at: number; text: string } | null>(null);
  const s = status?.snapshot ?? null;
  const alerts = status?.alerts ?? [];
  const problem = error ?? status?.error ?? null;

  return (
    <div className={`mw ${narrow ? "mw-compact" : ""}`} ref={scroller}>
      <div className="mw-page">
        <Header s={s} intervalSec={status?.intervalSec ?? 15} now={now} onPower={() => setMenu(true)} />
        {note && now - note.at < 60_000 && <p className="mw-note" role="status">{note.text}</p>}
        {problem && <p role="alert" className="mw-error">{problem}</p>}
        {!s ? (
          <div className="mw-panel mw-skeleton" />
        ) : narrow ? (
          <>
            <nav className="mw-tabs" role="tablist" aria-label="Разделы">
              {TABS.map((t) => (
                <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}>
                  {t.label}
                  {t.value === "overview" && alerts.length > 0 && <i className={`mw-tab-dot mw-tone-${alerts.some((a) => a.tone === "bad") ? "bad" : "warn"}`} />}
                </button>
              ))}
            </nav>
            {tab === "overview" && (
              <>
                <Verdict s={s} alerts={alerts} />
                <KpiGrid s={s} go={setTab} />
                <div className="mw-panel">
                  <TempsSection s={s} history={history} compact />
                  <HealthSection s={s} />
                  <NotifySection />
                </div>
              </>
            )}
            {tab === "system" && <SystemPanel s={s} history={history} range={range} setRange={setRange} />}
            {tab === "power" && <PowerPanel s={s} history={history} />}
            {tab === "apps" && <AppsPanel top={s.top} />}
          </>
        ) : (
          <>
            <Verdict s={s} alerts={alerts} />
            <KpiGrid s={s} wide go={(t) => document.getElementById(`mw-${t === "overview" ? "safety" : t}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
            <div className="mw-cols">
              <div className="mw-col">
                <div id="mw-system"><SystemPanel s={s} history={history} range={range} setRange={setRange} /></div>
                <div id="mw-apps"><AppsPanel top={s.top} limit={12} /></div>
              </div>
              <div className="mw-col">
                <div id="mw-safety"><SafetyPanel s={s} history={history} /></div>
                <div id="mw-power"><PowerPanel s={s} history={history} /></div>
              </div>
            </div>
          </>
        )}
        {s && s.missing.length > 0 && <p className="mw-caption">Не удалось прочитать: {s.missing.join(", ")}</p>}
      </div>
      {menu && s && <PowerMenu s={s} onClose={() => setMenu(false)} onNote={(text) => setNote({ at: Date.now(), text })} />}
    </div>
  );
}

// ---------- sidebar footer popover ----------

/** Just the latest sample, kept live; the popover needs no history. */
function useStatusOnly() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const read = useCallback(() => { rpc.call("status", null).then(setStatus, () => undefined); }, [rpc]);
  useEffect(read, [read]);
  useRealtime("sample", read);
  return status;
}

function FooterRow({ label, value, bar, color, tone }: { label: string; value: ReactNode; bar?: number | null; color?: string; tone?: Tone }) {
  return (
    <div className="mwf-row">
      <span className="mwf-label">{label}</span>
      {bar !== undefined ? <Bar value={bar} color={color ?? "var(--mw-blue)"} /> : <span />}
      <span className={`mwf-value ${tone ? `mw-text-${tone}` : ""}`}>{value}</span>
    </div>
  );
}

function MacWatchFooter({ dismiss }: ExperimentalSidebarFooterDisclosureProps) {
  const status = useStatusOnly();
  const navigate = useBbNavigate();
  const now = useNow(5000);
  const s = status?.snapshot ?? null;
  const alerts = status?.alerts ?? [];
  const age = s ? now - s.at : null;
  const stale = age === null || age > (status?.intervalSec ?? 15) * 4000;
  const m = s?.memory;
  const memPct = m ? (m.used / m.total) * 100 : null;
  const p = s?.power;
  const soc = s?.temps?.soc ?? null;
  const awake = s ? awakeVerdict(s.sleep) : null;
  return (
    <div className="mw mwf">
      <div className="mwf-head">
        <span className={`mw-dot ${stale ? "mw-dot-warn" : "mw-dot-good"}`} />
        <strong>{s?.host.name ?? "Mac"}</strong>
        <span className="mwf-age">{age === null ? "нет данных" : ago(age)}</span>
      </div>
      {!s ? <p className="mwf-empty">Загрузка…</p> : (
        <>
          {alerts.length > 0 ? (
            <div className="mwf-alerts">
              {alerts.slice(0, 3).map((a) => (
                <div key={a.id} className={`mwf-alert mw-tone-${a.tone}`}><Glyph name="alert" size={13} />{a.title}</div>
              ))}
              {alerts.length > 3 && <div className="mwf-more-alerts">и ещё {alerts.length - 3}</div>}
            </div>
          ) : (
            <div className="mwf-ok"><Glyph name="check" size={13} />Всё в порядке{awake?.tone === "good" ? " · не уснёт" : ""}</div>
          )}
          <FooterRow label="CPU" bar={s.cpu.usage} color="var(--mw-blue)" value={pct(s.cpu.usage)} />
          <FooterRow label="Память" bar={memPct} color="var(--mw-teal)" value={pct(memPct)}
            tone={m?.pressure === "critical" ? "bad" : m?.pressure === "warn" ? "warn" : undefined} />
          <FooterRow label="Процессор" bar={soc == null ? null : Math.min(100, soc)} color="var(--mw-orange)"
            value={soc == null ? "—" : `${Math.round(soc)} °C`} tone={tempTone(soc, 90, 100)} />
          <FooterRow label="Питание" bar={p?.percent ?? null} color="var(--mw-green)"
            value={!p ? "—" : `${p.percent ?? "—"}%${p.source === "ac" ? " ⚡" : ""}`}
            tone={p?.source === "battery" ? ((p.percent ?? 100) <= 20 ? "bad" : "warn") : undefined} />
          <FooterRow label="Диск" bar={s.disk ? (s.disk.used / s.disk.total) * 100 : null} color="var(--mw-orange)"
            value={s.disk ? `${formatBytes(s.disk.free, 0)} св.` : "—"} />
        </>
      )}
      <button type="button" className="mwf-open" onClick={() => { navigate.toPluginPanel("overview"); dismiss(); }}>
        Открыть Mac Watch<Glyph name="chevron" size={12} />
      </button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "overview",
    title: "Mac Watch",
    icon: "Laptop",
    path: "overview",
    component: MacWatchPage,
  });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "mac",
    label: "Mac Watch",
    icon: "Laptop",
    component: MacWatchFooter,
  });
});
