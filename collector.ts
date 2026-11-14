// Reads the Mac's state with stock macOS tools. No sudo, no extra installs.
import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import {
  cpuTimes, cpuUsage, groupProcs, parseAssertions, parseBattery, parseClamshell, parseDefaultInterface,
  parseKernTime, parseNetstat, parsePmsetSettings, parsePs, parseSwap, parseTherm, parseVmStat, pressureLevel,
  type CpuTimes, type Proc, type Snapshot,
} from "./core";

function run(file: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LANG: "C" } }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

type Static = { name: string; model: string; os: string; cores: number; memsize: number };

export class Collector {
  private prevCpu: CpuTimes | null = null;
  private prevNet: { iface: string; rx: number; tx: number; at: number } | null = null;
  private staticInfo: Static | null = null;
  private lastAt = 0;
  private slow: { at: number; disk: Snapshot["disk"]; top: Snapshot["top"]; thermal: Snapshot["thermal"]; missing: string[] } | null = null;

  /** Values that never change while BB runs. */
  private async loadStatic(): Promise<Static> {
    if (this.staticInfo) return this.staticInfo;
    const [name, model, version, memsize] = await Promise.all([
      run("/usr/sbin/scutil", ["--get", "ComputerName"]).then((s) => s.trim(), () => os.hostname()),
      run("/usr/sbin/sysctl", ["-n", "hw.model"]).then((s) => s.trim(), () => ""),
      run("/usr/bin/sw_vers", ["-productVersion"]).then((s) => s.trim(), () => os.release()),
      run("/usr/sbin/sysctl", ["-n", "hw.memsize"]).then((s) => Number(s.trim()), () => os.totalmem()),
    ]);
    this.staticInfo = { name, model, os: `macOS ${version}`, cores: os.cpus().length, memsize };
    return this.staticInfo;
  }

  /** Disk, processes and thermal state change slowly and cost more; refresh them once a minute. */
  private async loadSlow(now: number) {
    if (this.slow && now - this.slow.at < 60_000) return this.slow;
    const missing: string[] = [];
    const [disk, ps, therm] = await Promise.all([
      statfs("/").then((s) => {
        const total = s.blocks * s.bsize;
        const free = s.bavail * s.bsize;
        return { total, free, used: total - free };
      }, () => (missing.push("диск"), null)),
      run("/bin/ps", ["-Ao", "pid=,pcpu=,rss=,comm="]).then(parsePs, () => (missing.push("процессы"), [] as Proc[])),
      run("/usr/bin/pmset", ["-g", "therm"]).then(parseTherm, () => null),
    ]);
    const top = { cpu: groupProcs(ps, "cpu", 8), memory: groupProcs(ps, "memory", 12) };
    this.slow = { at: now, disk, top, thermal: therm, missing };
    return this.slow;
  }

  async sample(): Promise<Snapshot> {
    const now = Date.now();
    // After sleep, deltas would average over the nap; start them over instead.
    if (now - this.lastAt > 90_000) {
      this.prevCpu = null;
      this.prevNet = null;
    }
    this.lastAt = now;
    const info = await this.loadStatic();
    const missing: string[] = [];
    const soft = <T>(label: string, promise: Promise<T>): Promise<T | null> =>
      promise.catch(() => {
        missing.push(label);
        return null;
      });

    const [vm, sysctl, assertions, pmsetG, clamshell, battery, batt, route, slow] = await Promise.all([
      soft("память", run("/usr/bin/vm_stat", [])),
      soft("sysctl", run("/usr/sbin/sysctl", ["vm.swapusage", "kern.memorystatus_vm_pressure_level", "kern.waketime", "kern.sleeptime"])),
      soft("запреты сна", run("/usr/bin/pmset", ["-g", "assertions"])),
      soft("настройки сна", run("/usr/bin/pmset", ["-g"])),
      soft("крышка", run("/usr/sbin/ioreg", ["-r", "-k", "AppleClamshellState", "-d", "1"])),
      soft("батарея", run("/usr/sbin/ioreg", ["-rn", "AppleSmartBattery"])),
      soft("питание", run("/usr/bin/pmset", ["-g", "batt"])),
      run("/sbin/route", ["-n", "get", "default"]).catch(() => ""),
      this.loadSlow(now),
    ]);

    // CPU: difference between two os.cpus() readings.
    const times = cpuTimes(os.cpus());
    const usage = cpuUsage(this.prevCpu, times);
    this.prevCpu = times;
    const load = os.loadavg().map((n) => Math.round(n * 100) / 100) as [number, number, number];

    const line = (key: string) => new RegExp(`^${key.replace(/\./g, "\\.")}: (.*)$`, "m").exec(sysctl ?? "")?.[1] ?? "";
    const swap = parseSwap(line("vm.swapusage"));
    const memory = vm
      ? {
        ...parseVmStat(vm, info.memsize),
        swapUsed: swap?.used ?? null,
        swapTotal: swap?.total ?? null,
        pressure: pressureLevel(Number(line("kern.memorystatus_vm_pressure_level")) || null),
      }
      : null;

    // Network: bytes per second on the default route's interface.
    let network: Snapshot["network"] = null;
    const iface = parseDefaultInterface(route);
    if (iface) {
      const counters = await run("/usr/sbin/netstat", ["-ibn", "-I", iface]).then((t) => parseNetstat(t, iface), () => null);
      if (counters) {
        const prev = this.prevNet?.iface === iface ? this.prevNet : null;
        const dt = prev ? (now - prev.at) / 1000 : 0;
        const rate = (a: number, b: number) => (prev && dt > 0 && a >= b ? (a - b) / dt : null);
        network = { iface, rxBps: rate(counters.rx, prev?.rx ?? 0), txBps: rate(counters.tx, prev?.tx ?? 0) };
        this.prevNet = { iface, ...counters, at: now };
      }
    }

    const settings = pmsetG ? parsePmsetSettings(pmsetG) : null;
    const held = assertions ? parseAssertions(assertions) : null;
    const sleep: Snapshot["sleep"] = settings && held
      ? { ...settings, ...held, lidClosed: clamshell ? parseClamshell(clamshell) : null }
      : null;

    return {
      at: now,
      host: {
        name: info.name,
        model: info.model,
        os: info.os,
        cores: info.cores,
        uptimeSec: Math.round(os.uptime()),
        lastSleepAt: parseKernTime(line("kern.sleeptime")),
        lastWakeAt: parseKernTime(line("kern.waketime")),
      },
      cpu: { usage, load },
      memory,
      disk: slow.disk,
      power: battery !== null || batt !== null ? parseBattery(battery ?? "", batt ?? "") : null,
      network,
      sleep,
      thermal: slow.thermal,
      top: slow.top,
      missing: [...missing, ...slow.missing],
    };
  }
}
