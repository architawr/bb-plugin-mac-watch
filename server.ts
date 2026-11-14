// Mac Watch: the health of the Mac that runs this BB server, readable from anywhere.
//
// A background service samples the Mac every 15 seconds with stock macOS tools
// (no sudo). The latest sample and 24 hours of history feed the sidebar page
// over RPC, the `bb mac-watch` command and the agent skill.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { Collector } from "./collector";
import { appIcon } from "./icons";
import {
  awakeVerdict, deriveAlerts, downsample, formatBytes, formatDuration, formatRate, toPoint,
  type Alert, type HistoryPoint, type Snapshot,
} from "./core";

const INTERVAL_MS = 15_000;
const DAY_MS = 24 * 3600_000;
const PERSIST_EVERY_MS = 60_000;
const RANGES = { 1: 15_000, 6: 90_000, 24: 360_000 } as const;

const statusSchema = z.object({
  snapshot: z.custom<Snapshot>().nullable(),
  alerts: z.custom<Alert[]>(),
  error: z.string().nullable(),
  intervalSec: z.number(),
});

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  history: {
    input: z.object({ hours: z.union([z.literal(1), z.literal(6), z.literal(24)]) }),
    output: z.object({ points: z.custom<HistoryPoint[]>(), bucketMs: z.number() }),
  },
  refresh: { input: z.null(), output: statusSchema },
  icons: {
    input: z.object({ apps: z.array(z.string().max(1024)).max(40) }),
    output: z.record(z.string(), z.string().nullable()),
  },
});

/** Realtime channel the page listens on; payload is the sample time. */
export const SAMPLE_CHANNEL = "sample";

export default async function plugin(bb: BbPluginApi) {
  const collector = new Collector();
  let snapshot: Snapshot | null = null;
  let recent: Snapshot[] = [];
  let error: string | null = null;
  let busy: Promise<void> | null = null;
  let lastPersist = Date.now();
  // Restored at one-minute resolution; fresh samples append at full resolution.
  let points: HistoryPoint[] = ((await bb.storage.kv.get<HistoryPoint[]>("history")) ?? [])
    .filter((p) => p.at > Date.now() - DAY_MS);

  const status = () => ({
    snapshot,
    alerts: snapshot ? deriveAlerts(snapshot, recent.slice(0, -1)) : [],
    error,
    intervalSec: INTERVAL_MS / 1000,
  });

  async function persist() {
    lastPersist = Date.now();
    // 1440 one-minute points ≈ 120 KB, under the 256 KB KV value limit.
    await bb.storage.kv.set("history", downsample(points, Date.now() - DAY_MS, 60_000));
  }

  async function tick() {
    if (busy) return busy;
    busy = (async () => {
      try {
        const next = await collector.sample();
        snapshot = next;
        recent = [...recent, next].slice(-12);
        points = [...points.filter((p) => p.at > next.at - DAY_MS), toPoint(next)];
        error = null;
        bb.realtime.publish(SAMPLE_CHANNEL, { at: next.at });
        if (Date.now() - lastPersist > PERSIST_EVERY_MS) await persist();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        bb.log.warn(`sample failed: ${error}`);
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  bb.rpc.register(rpcContract, {
    status: async () => {
      if (!snapshot) await tick();
      return status();
    },
    history: async ({ hours }) => {
      const bucketMs = RANGES[hours];
      return { points: downsample(points, Date.now() - hours * 3600_000, bucketMs), bucketMs };
    },
    refresh: async () => {
      await tick();
      return status();
    },
    icons: async ({ apps }) => {
      // Only bundles the collector reported: the page cannot make us read arbitrary paths.
      const known = new Set([...(snapshot?.top.cpu ?? []), ...(snapshot?.top.memory ?? [])].map((p) => p.app));
      const entries = await Promise.all(
        apps.filter((app) => known.has(app)).map(async (app) => [app, await appIcon(app)] as const),
      );
      return Object.fromEntries(entries);
    },
  });

  function summary(): string {
    const s = snapshot;
    if (!s) return error ? `Нет данных: ${error}` : "Нет данных: первый замер ещё не готов.";
    const verdict = awakeVerdict(s.sleep);
    const lines = [
      `${s.host.name} · ${s.host.os} · работает ${formatDuration(s.host.uptimeSec)}`,
      `Сон: ${verdict.title}. ${verdict.detail}`,
      `CPU ${s.cpu.usage ?? "—"}% · load ${s.cpu.load.join(" / ")}`,
      s.memory ? `Память ${formatBytes(s.memory.used)} из ${formatBytes(s.memory.total, 0)} · давление ${({ normal: "норма", warn: "высокое", critical: "критическое" } as const)[s.memory.pressure ?? "normal"]}` : "Память —",
      s.disk ? `Диск свободно ${formatBytes(s.disk.free)} из ${formatBytes(s.disk.total, 0)}` : "Диск —",
      s.power
        ? `Питание: ${s.power.source === "ac" ? "сеть" : "батарея"} · ${s.power.percent ?? "—"}%${s.power.charging ? " заряжается" : ""} · Мак берёт ${s.power.systemWatts ?? "—"} Вт`
        : "Питание —",
      s.network ? `Сеть ${s.network.iface}: ↓ ${formatRate(s.network.rxBps)} ↑ ${formatRate(s.network.txBps)}` : "Сеть —",
    ];
    const alerts = status().alerts;
    lines.push(alerts.length ? "Внимание:\n" + alerts.map((a) => `  • ${a.title}. ${a.detail}`).join("\n") : "Всё в порядке.");
    return lines.join("\n");
  }

  bb.cli.register({
    name: "mac-watch",
    summary: "Показатели Мака, на котором работает BB: CPU, память, диск, питание, сон",
    commands: [
      { name: "status", summary: "Сводка последнего замера", usage: "bb mac-watch status [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command !== "status" && command !== undefined) {
        return { exitCode: 1, stderr: "Usage: bb mac-watch status [--json]" };
      }
      if (!snapshot) await tick();
      if (json) {
        const s = status();
        // Bounded: one snapshot, no history.
        return { exitCode: 0, stdout: JSON.stringify({ ...s, verdict: awakeVerdict(s.snapshot?.sleep ?? null) }) };
      }
      return { exitCode: 0, stdout: summary() };
    },
  });

  bb.background.service("poll", {
    async start(signal) {
      while (!signal.aborted) {
        await tick();
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, INTERVAL_MS);
          signal.addEventListener("abort", done, { once: true });
        });
      }
      await persist().catch(() => undefined);
    },
  });
}
