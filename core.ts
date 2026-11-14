// Pure parsers and derived state for Mac Watch.
// Everything here takes command output as text and returns typed values, so
// it runs under `node --test` without touching the machine.

export type Tone = "good" | "warn" | "bad";

export type SleepHolder = {
  pid: number;
  process: string;
  type: string;
  name: string;
};

/** `app` is the .app bundle path when the process belongs to one; the page shows its icon. */
export type Proc = { pid: number; name: string; cpu: number; memory: number; app: string | null };

export type Snapshot = {
  at: number;
  host: {
    name: string;
    model: string;
    os: string;
    cores: number;
    uptimeSec: number | null;
    lastSleepAt: number | null;
    lastWakeAt: number | null;
  };
  cpu: { usage: number | null; load: [number, number, number] };
  memory: {
    total: number;
    used: number;
    app: number;
    wired: number;
    compressed: number;
    cached: number;
    free: number;
    swapUsed: number | null;
    swapTotal: number | null;
    pressure: "normal" | "warn" | "critical" | null;
  } | null;
  disk: { total: number; free: number; used: number } | null;
  power: {
    source: "ac" | "battery";
    percent: number | null;
    charging: boolean;
    fullyCharged: boolean;
    minutesToEmpty: number | null;
    minutesToFull: number | null;
    /** Positive while the battery charges, negative while it drains. */
    batteryWatts: number | null;
    /** What the whole Mac draws right now. */
    systemWatts: number | null;
    adapterWatts: number | null;
    adapterName: string | null;
    cycles: number | null;
    healthPct: number | null;
    temperatureC: number | null;
  } | null;
  network: { iface: string; rxBps: number | null; txBps: number | null } | null;
  sleep: {
    sleepDisabled: boolean;
    lidClosed: boolean | null;
    idleSleepPrevented: boolean;
    displaySleepPrevented: boolean;
    idleSleepMinutes: number | null;
    holders: SleepHolder[];
  } | null;
  thermal: { throttled: boolean; cpuSpeedLimit: number | null } | null;
  top: { cpu: Proc[]; memory: Proc[] };
  /** Sources that failed in this sample, for a quiet footnote in the UI. */
  missing: string[];
};

export type Alert = { id: string; tone: Exclude<Tone, "good">; title: string; detail: string };

export type HistoryPoint = {
  at: number;
  cpu: number | null;
  memory: number | null;
  rx: number | null;
  tx: number | null;
  battery: number | null;
  watts: number | null;
};

// ---------- small helpers ----------

const num = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** ioreg prints signed 64-bit values as unsigned. */
export function signed64(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return num(value);
  const big = BigInt(value);
  return Number(big >= 2n ** 63n ? big - 2n ** 64n : big);
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

// ---------- memory ----------

export function parseVmStat(text: string, totalBytes: number) {
  const page = num(/page size of (\d+) bytes/.exec(text)?.[1]) ?? 16384;
  const read = (label: string) => {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(text);
    return (num(match?.[1]) ?? 0) * page;
  };
  const free = read("Pages free") + read("Pages speculative");
  const wired = read("Pages wired down");
  const compressed = read("Pages occupied by compressor");
  const purgeable = read("Pages purgeable");
  const external = read("File-backed pages");
  const internal = read("Anonymous pages");
  // Activity Monitor: App memory = anonymous − purgeable; Used = App + Wired + Compressed.
  const app = Math.max(0, internal - purgeable);
  const used = Math.min(totalBytes, app + wired + compressed);
  const cached = external + purgeable;
  return { total: totalBytes, used, app, wired, compressed, cached, free };
}

export function parseSwap(text: string): { used: number; total: number } | null {
  const total = /total = ([\d.]+)M/.exec(text)?.[1];
  const used = /used = ([\d.]+)M/.exec(text)?.[1];
  if (total === undefined || used === undefined) return null;
  return { total: Number(total) * 1024 ** 2, used: Number(used) * 1024 ** 2 };
}

export function pressureLevel(value: number | null): "normal" | "warn" | "critical" | null {
  if (value === 1) return "normal";
  if (value === 2) return "warn";
  if (value === 4) return "critical";
  return null;
}

// ---------- sleep ----------

export function parsePmsetSettings(text: string) {
  const sleepDisabled = /SleepDisabled\s+1/.test(text);
  const sleep = /^\s*sleep\s+(\d+)/m.exec(text)?.[1];
  return { sleepDisabled, idleSleepMinutes: num(sleep) };
}

export function parseAssertions(text: string) {
  const level = (type: string) => num(new RegExp(`^\\s+${type}\\s+(\\d+)`, "m").exec(text)?.[1]) ?? 0;
  const holders: SleepHolder[] = [];
  const re = /^\s+pid (\d+)\(([^)]*)\): \[[^\]]*\] [\d:]+ (\w+) named: "([^"]*)"/gm;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    holders.push({ pid: Number(match[1]), process: match[2]!, type: match[3]!, name: match[4]! });
  }
  const preventsSystem = new Set(["PreventUserIdleSystemSleep", "NoIdleSleepAssertion", "PreventSystemSleep"]);
  const preventsDisplay = new Set(["PreventUserIdleDisplaySleep", "NoDisplaySleepAssertion"]);
  return {
    idleSleepPrevented: level("PreventUserIdleSystemSleep") > 0 || level("PreventSystemSleep") > 0
      || holders.some((h) => preventsSystem.has(h.type)),
    displaySleepPrevented: level("PreventUserIdleDisplaySleep") > 0 || holders.some((h) => preventsDisplay.has(h.type)),
    holders: holders.filter((h) => preventsSystem.has(h.type) || preventsDisplay.has(h.type)),
  };
}

export function parseClamshell(text: string): boolean | null {
  const state = /"AppleClamshellState" = (Yes|No)/.exec(text)?.[1];
  return state === undefined ? null : state === "Yes";
}

/** `sysctl -n kern.waketime` → `{ sec = 1794641792, usec = 535141 } Sat Nov …` */
export function parseKernTime(text: string): number | null {
  const sec = num(/sec = (\d+)/.exec(text)?.[1]);
  return sec === null || sec === 0 ? null : sec * 1000;
}

// ---------- power ----------

function ioregValue(text: string, key: string): string | undefined {
  return new RegExp(`^\\s+"${key}" = (.+)$`, "m").exec(text)?.[1]?.trim();
}

export function parseBattery(ioreg: string, pmsetBatt: string): Snapshot["power"] {
  const installed = ioregValue(ioreg, "BatteryInstalled");
  const fromAc = /drawing from 'AC Power'/.test(pmsetBatt) || ioregValue(ioreg, "ExternalConnected") === "Yes";
  if (installed === undefined && !/InternalBattery/.test(pmsetBatt)) {
    return fromAc ? {
      source: "ac", percent: null, charging: false, fullyCharged: false, minutesToEmpty: null,
      minutesToFull: null, batteryWatts: null, systemWatts: null, adapterWatts: null, adapterName: null,
      cycles: null, healthPct: null, temperatureC: null,
    } : null;
  }
  const percent = num(/(\d+)%;/.exec(pmsetBatt)?.[1]) ?? num(ioregValue(ioreg, "CurrentCapacity"));
  const voltage = num(ioregValue(ioreg, "Voltage"));
  const amperage = signed64(ioregValue(ioreg, "InstantAmperage") ?? ioregValue(ioreg, "Amperage"));
  const telemetry = ioregValue(ioreg, "PowerTelemetryData") ?? "";
  const systemLoad = num(/"SystemLoad"=(\d+)/.exec(telemetry)?.[1]);
  const adapter = ioregValue(ioreg, "AdapterDetails") ?? "";
  const design = num(ioregValue(ioreg, "DesignCapacity"));
  const nominal = num(ioregValue(ioreg, "NominalChargeCapacity")) ?? num(ioregValue(ioreg, "AppleRawMaxCapacity"));
  const temperature = num(ioregValue(ioreg, "Temperature"));
  const minutes = (key: string) => {
    const value = num(ioregValue(ioreg, key));
    return value === null || value >= 65535 || value <= 0 ? null : value;
  };
  const batteryWatts = voltage !== null && amperage !== null ? round((voltage * amperage) / 1e6, 2) : null;
  const charging = ioregValue(ioreg, "IsCharging") === "Yes" || /; charging;/.test(pmsetBatt);
  return {
    source: fromAc ? "ac" : "battery",
    percent,
    charging,
    fullyCharged: ioregValue(ioreg, "FullyCharged") === "Yes" || /; charged;/.test(pmsetBatt),
    minutesToEmpty: fromAc ? null : minutes("AvgTimeToEmpty") ?? minutes("TimeRemaining"),
    minutesToFull: charging ? minutes("AvgTimeToFull") : null,
    batteryWatts,
    systemWatts: systemLoad !== null && systemLoad > 0 ? round(systemLoad / 1000, 1)
      : batteryWatts !== null && batteryWatts < 0 ? -batteryWatts : null,
    adapterWatts: fromAc ? num(/"Watts"=(\d+)/.exec(adapter)?.[1]) : null,
    adapterName: fromAc ? /"Description"="([^"]*)"/.exec(adapter)?.[1] ?? null : null,
    cycles: num(ioregValue(ioreg, "CycleCount")),
    healthPct: design && nominal ? Math.min(100, Math.round((nominal / design) * 100)) : null,
    temperatureC: temperature === null ? null : round(temperature / 100, 1),
  };
}

export function parseTherm(text: string): Snapshot["thermal"] {
  const limit = num(/CPU_Speed_Limit\s*=\s*(\d+)/.exec(text)?.[1]);
  const warning = /thermal warning level set to (\d+)/i.exec(text)?.[1];
  return { cpuSpeedLimit: limit, throttled: (limit !== null && limit < 100) || (warning !== undefined && warning !== "0") };
}

// ---------- network ----------

export function parseDefaultInterface(text: string): string | null {
  return /interface: (\S+)/.exec(text)?.[1] ?? null;
}

/** Byte counters of one interface from `netstat -ibn` (the `<Link#…>` row). */
export function parseNetstat(text: string, iface: string): { rx: number; tx: number } | null {
  for (const line of text.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== iface || !cols[2]?.startsWith("<Link#")) continue;
    // Name Mtu Network Address? Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll — Address may be empty.
    const tail = cols.slice(-7);
    const rx = num(tail[2]);
    const tx = num(tail[5]);
    return rx === null || tx === null ? null : { rx, tx };
  }
  return null;
}

// ---------- processes ----------

export function parsePs(text: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const path = match[4]!.trim();
    // Name an app after its outermost bundle, so helpers group under it: ".../bb.app/Contents/..." → "bb".
    const bundle = /^(.*?\/([^/]+)\.app)\//.exec(path);
    const name = bundle?.[2] ?? path.split("/").pop() ?? path;
    procs.push({ pid: Number(match[1]), name, cpu: Number(match[2]), memory: Number(match[3]) * 1024, app: bundle?.[1] ?? null });
  }
  return procs;
}

/** Many helpers belong to one app; group them so the list reads like Activity Monitor. */
export function groupProcs(procs: Proc[], by: "cpu" | "memory", limit = 8): Proc[] {
  const groups = new Map<string, Proc>();
  for (const p of procs) {
    const key = p.name.replace(/ Helper.*$/, "").replace(/ \(.*\)$/, "");
    const group = groups.get(key);
    if (group) {
      group.cpu += p.cpu;
      group.memory += p.memory;
      group.app ??= p.app;
    } else groups.set(key, { ...p, name: key });
  }
  return [...groups.values()]
    .sort((a, b) => b[by] - a[by])
    .slice(0, limit)
    .map((p) => ({ ...p, cpu: round(p.cpu, 1) }));
}

// ---------- CPU ----------

export type CpuTimes = { idle: number; total: number };

export function cpuTimes(cpus: { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

export function cpuUsage(prev: CpuTimes | null, next: CpuTimes): number | null {
  if (!prev) return null;
  const total = next.total - prev.total;
  if (total <= 0) return null;
  return round(Math.min(100, Math.max(0, (1 - (next.idle - prev.idle) / total) * 100)), 1);
}

// ---------- alerts ----------

const GB = 1024 ** 3;

/** What deserves attention right now. `recent` is the last few minutes, oldest first. */
export function deriveAlerts(s: Snapshot, recent: Snapshot[]): Alert[] {
  const alerts: Alert[] = [];
  const p = s.power;
  if (p?.source === "battery") {
    const low = p.percent !== null && p.percent <= 20;
    alerts.push({
      id: "on-battery",
      tone: low ? "bad" : "warn",
      title: low ? `Батарея садится: ${p.percent}%` : "Мак работает от батареи",
      detail: p.minutesToEmpty ? `Хватит примерно на ${formatMinutes(p.minutesToEmpty)}.` : "Проверьте, подключена ли зарядка.",
    });
  }
  const draining = [...recent, s].slice(-4);
  if (
    p?.source === "ac" && draining.length >= 3
    && draining.every((x) => x.power?.source === "ac" && (x.power.batteryWatts ?? 0) < -0.5)
  ) {
    alerts.push({
      id: "ac-drain",
      tone: "warn",
      title: "Зарядка не успевает",
      detail: `Мак берёт из батареи ${Math.abs(p.batteryWatts ?? 0).toFixed(1)} Вт, хотя подключён к сети${p.adapterWatts ? ` (${p.adapterWatts} Вт)` : ""}. Нужен адаптер мощнее.`,
    });
  }
  if (s.memory?.pressure === "critical" || s.memory?.pressure === "warn") {
    alerts.push({
      id: "memory",
      tone: s.memory.pressure === "critical" ? "bad" : "warn",
      title: s.memory.pressure === "critical" ? "Памяти критически не хватает" : "Память под нагрузкой",
      detail: "macOS активно сжимает память и пишет в своп. Закройте тяжёлые приложения.",
    });
  }
  if (s.disk && (s.disk.free < 10 * GB || s.disk.free / s.disk.total < 0.05)) {
    alerts.push({ id: "disk", tone: "bad", title: "Диск почти заполнен", detail: `Свободно ${formatBytes(s.disk.free)}.` });
  } else if (s.disk && s.disk.free < 25 * GB) {
    alerts.push({ id: "disk", tone: "warn", title: "Мало места на диске", detail: `Свободно ${formatBytes(s.disk.free)}.` });
  }
  const busy = [...recent, s].slice(-8);
  if (busy.length >= 8 && busy.every((x) => (x.cpu.usage ?? 0) >= 90)) {
    alerts.push({ id: "cpu", tone: "warn", title: "Процессор загружен на 90%+", detail: "Уже несколько минут подряд." });
  }
  if (s.thermal?.throttled) {
    alerts.push({ id: "thermal", tone: "warn", title: "Мак перегревается", detail: "macOS снижает частоту процессора." });
  }
  if (p?.temperatureC != null && p.temperatureC >= 45) {
    alerts.push({ id: "battery-temp", tone: "warn", title: `Батарея нагрета до ${p.temperatureC}°`, detail: "Выше 45° она изнашивается быстрее." });
  }
  const sl = s.sleep;
  if (sl && sl.lidClosed && !sl.sleepDisabled) {
    alerts.push({
      id: "lid",
      tone: "warn",
      title: "Крышка закрыта, сон не запрещён",
      detail: "Мак держится на внешнем мониторе или запрете приложения. Без них он уснёт.",
    });
  } else if (sl && !sl.idleSleepPrevented && !sl.sleepDisabled && (sl.idleSleepMinutes ?? 0) > 0) {
    alerts.push({
      id: "idle",
      tone: "warn",
      title: "Мак может уснуть",
      detail: `Никто не держит его бодрым: уснёт после ${sl.idleSleepMinutes} мин бездействия.`,
    });
  }
  return alerts;
}

/** Will the Mac stay reachable? Read only from macOS state, no app-specific logic. */
export function awakeVerdict(sl: Snapshot["sleep"]): { tone: Tone; title: string; detail: string } {
  if (!sl) return { tone: "warn", title: "Нет данных о сне", detail: "pmset не ответил." };
  if (sl.sleepDisabled) {
    return { tone: "good", title: "Мак не уснёт", detail: "Сон запрещён на уровне системы, даже с закрытой крышкой." };
  }
  if (sl.lidClosed) {
    return { tone: "warn", title: "Держится, но ненадёжно", detail: "Крышка закрыта, а сон с закрытой крышкой не запрещён." };
  }
  if (sl.idleSleepPrevented) {
    return { tone: "good", title: "Мак не уснёт от бездействия", detail: "Но закрытая крышка его усыпит: сон не запрещён системно." };
  }
  if (!sl.idleSleepMinutes) {
    return { tone: "good", title: "Сон от бездействия выключен", detail: "Так настроено в macOS. Закрытая крышка его усыпит." };
  }
  return { tone: "bad", title: "Мак уснёт", detail: `Через ${sl.idleSleepMinutes} мин бездействия. Никто не держит его бодрым.` };
}

// ---------- formatting shared with the UI ----------

/** Russian number formatting: decimal comma, as macOS shows it. */
export const ru = (n: number, digits = 1) =>
  n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatBytes(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  if (n >= 1024 ** 4) return ru(n / 1024 ** 4, digits) + " ТБ";
  if (n >= GB) return ru(n / GB, digits) + " ГБ";
  if (n >= 1024 ** 2) return ru(n / 1024 ** 2, n >= 100 * 1024 ** 2 ? 0 : 1) + " МБ";
  return ru(n / 1024, 0) + " КБ";
}

export function formatRate(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (bps >= 1024 ** 2) return ru(bps / 1024 ** 2, 1) + " МБ/с";
  if (bps >= 1024) return ru(bps / 1024, 0) + " КБ/с";
  return Math.round(bps) + " Б/с";
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} мин`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

// ---------- history ----------

export function toPoint(s: Snapshot): HistoryPoint {
  return {
    at: s.at,
    cpu: s.cpu.usage,
    memory: s.memory ? round((s.memory.used / s.memory.total) * 100, 1) : null,
    rx: s.network?.rxBps ?? null,
    tx: s.network?.txBps ?? null,
    battery: s.power?.percent ?? null,
    watts: s.power?.systemWatts ?? null,
  };
}

/** Average points into fixed buckets; empty buckets stay out so charts show gaps. */
export function downsample(points: HistoryPoint[], from: number, bucketMs: number): HistoryPoint[] {
  const buckets = new Map<number, HistoryPoint[]>();
  for (const p of points) {
    if (p.at < from) continue;
    const key = Math.floor(p.at / bucketMs) * bucketMs;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(p);
  }
  const avg = (list: HistoryPoint[], key: keyof Omit<HistoryPoint, "at">) => {
    const values = list.map((p) => p[key]).filter((v): v is number => v !== null);
    return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : null;
  };
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([at, list]) => ({
      at: at + bucketMs / 2,
      cpu: avg(list, "cpu"),
      memory: avg(list, "memory"),
      rx: avg(list, "rx"),
      tx: avg(list, "tx"),
      battery: avg(list, "battery"),
      watts: avg(list, "watts"),
    }));
}
