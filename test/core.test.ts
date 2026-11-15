import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  awakeVerdict, deriveAlerts, downsample, groupProcs, inQuietHours, parseAssertions, parseBattery, parseClamshell,
  parseDefaultInterface, parseKernTime, parseNetstat, parsePmsetSettings, parsePs, parseQuietHours, parseSwap,
  parseTherm, parseVmStat, signed64, type Snapshot,
} from "../core.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("vm_stat gives Activity Monitor style memory", () => {
  const total = 24 * 1024 ** 3;
  const m = parseVmStat(fixture("vm_stat.txt"), total);
  assert.ok(m.used > 0 && m.used <= total);
  assert.ok(m.wired > 0 && m.app > 0);
  assert.equal(m.total, total);
});

test("swap usage", () => {
  assert.deepEqual(parseSwap("total = 3072.00M  used = 1711.00M  free = 1361.00M  (encrypted)"), {
    total: 3072 * 1024 ** 2,
    used: 1711 * 1024 ** 2,
  });
});

test("pmset settings: SleepDisabled and idle sleep", () => {
  const s = parsePmsetSettings(fixture("pmset-g.txt"));
  assert.equal(s.sleepDisabled, true);
  assert.equal(s.idleSleepMinutes, 0);
});

test("assertions list who keeps the Mac awake", () => {
  const a = parseAssertions(fixture("pmset-assertions.txt"));
  assert.equal(a.idleSleepPrevented, true);
  assert.equal(a.displaySleepPrevented, true);
  const names = a.holders.map((h) => h.process);
  assert.ok(names.includes("Vorssaint"));
  assert.ok(names.includes("Google Chrome"));
  // UserIsActive and internal display assertions are not sleep holders.
  assert.ok(!a.holders.some((h) => h.type === "UserIsActive"));
});

test("clamshell state", () => {
  assert.equal(parseClamshell(fixture("ioreg-clamshell.txt")), false);
  assert.equal(parseClamshell('  "AppleClamshellState" = Yes'), true);
  assert.equal(parseClamshell(""), null);
});

test("battery and power", () => {
  const p = parseBattery(fixture("ioreg-battery.txt"), fixture("pmset-batt.txt"));
  assert.ok(p);
  assert.equal(p.source, "ac");
  assert.equal(p.percent, 100);
  assert.equal(p.adapterWatts, 17);
  assert.equal(p.adapterName, "pd charger");
  assert.equal(p.cycles, 213);
  assert.equal(p.healthPct, 94);
  assert.equal(p.temperatureC, 30.4);
  assert.equal(p.systemWatts, 8.4);
});

test("battery draining on AC is negative watts", () => {
  const ioreg = '      "Voltage" = 12992\n      "InstantAmperage" = 18446744073709550815\n      "BatteryInstalled" = Yes\n      "ExternalConnected" = Yes';
  const p = parseBattery(ioreg, "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t99%; charged; 0:00 remaining present: true");
  assert.ok(p && p.batteryWatts !== null && p.batteryWatts < -10);
  assert.equal(signed64("18446744073709550815"), -801);
});

test("thermal note means no throttling", () => {
  assert.deepEqual(parseTherm(fixture("pmset-therm.txt")), { cpuSpeedLimit: null, throttled: false });
  assert.equal(parseTherm("CPU_Speed_Limit = 70").throttled, true);
});

test("network counters of the default interface", () => {
  assert.equal(parseDefaultInterface(fixture("route.txt")), "en0");
  assert.deepEqual(parseNetstat(fixture("netstat.txt"), "en0"), { rx: 356009457620, tx: 118519323225 });
  assert.deepEqual(parseNetstat(fixture("netstat.txt"), "utun0"), { rx: 0, tx: 100 });
});

test("processes group helpers under their app", () => {
  const procs = parsePs(fixture("ps.txt"));
  const top = groupProcs(procs, "cpu");
  const bb = top.find((p) => p.name === "bb");
  assert.ok(bb);
  assert.equal(bb.cpu, 24.5);
  assert.equal(top[0]!.name, "WindowServer");
});

test("kern time", () => {
  assert.equal(parseKernTime("{ sec = 1794641792, usec = 535141 } Sat Nov 14"), 1794641792000);
  assert.equal(parseKernTime("{ sec = 0, usec = 0 }"), null);
});

const base: Snapshot = {
  at: 0,
  host: { name: "Mac", model: "", os: "", cores: 10, uptimeSec: 1, lastSleepAt: null, lastWakeAt: null },
  cpu: { usage: 10, load: [1, 1, 1] },
  memory: null,
  disk: { total: 500e9, free: 180e9, used: 320e9, smart: "Verified" },
  power: null,
  network: null,
  sleep: { sleepDisabled: true, lidClosed: true, idleSleepPrevented: true, displaySleepPrevented: false, idleSleepMinutes: 1, holders: [] },
  thermal: null,
  thermalPressure: 0,
  temps: null,
  batterySafety: null,
  panics: [],
  top: { cpu: [], memory: [] },
  missing: [],
};

test("alerts: all quiet", () => {
  assert.deepEqual(deriveAlerts(base, []), []);
  assert.equal(awakeVerdict(base.sleep).tone, "good");
});

test("alerts: AC drain needs several samples in a row", () => {
  const drain: Snapshot = {
    ...base,
    power: {
      source: "ac", percent: 90, charging: false, fullyCharged: false, minutesToEmpty: null, minutesToFull: null,
      batteryWatts: -9, systemWatts: 26, adapterWatts: 17, adapterName: "pd charger", cycles: 1, healthPct: 100, temperatureC: 30,
    },
  };
  assert.equal(deriveAlerts(drain, []).length, 0);
  assert.equal(deriveAlerts(drain, [drain, drain])[0]?.id, "ac-drain");
});

test("alerts: being free to sleep is not an alert", () => {
  const s: Snapshot = { ...base, sleep: { ...base.sleep!, sleepDisabled: false, lidClosed: false, idleSleepPrevented: false, idleSleepMinutes: 10 } };
  assert.deepEqual(deriveAlerts(s, []), []);
  assert.equal(awakeVerdict(s.sleep).tone, "bad");
});

test("downsample keeps gaps", () => {
  const p = (at: number, cpu: number) => ({ at, cpu, memory: null, rx: null, tx: null, battery: null, watts: null });
  const out = downsample([p(0, 10), p(10, 20), p(1000, 40)], 0, 100);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.cpu, 15);
});

test("quiet hours: a wrapped window covers midnight, off and garbage mean none", () => {
  assert.deepEqual(parseQuietHours("23:00-09:00"), { from: 1380, to: 540 });
  assert.deepEqual(parseQuietHours(" 1:5 - 6:30 "), { from: 65, to: 390 });
  assert.equal(parseQuietHours("off"), null);
  assert.equal(parseQuietHours(""), null);
  assert.equal(parseQuietHours("25:00-09:00"), null);
  assert.equal(parseQuietHours("12:00-12:00"), null);
  const at = (hours: number, minutes = 0) => new Date(2026, 10, 15, hours, minutes);
  const night = parseQuietHours("23:00-09:00")!;
  assert.equal(inQuietHours(at(23, 30), night), true);
  assert.equal(inQuietHours(at(0), night), true);
  assert.equal(inQuietHours(at(8, 59), night), true);
  assert.equal(inQuietHours(at(9), night), false);
  assert.equal(inQuietHours(at(22, 59), night), false);
  assert.equal(inQuietHours(at(12), null), false);
  const day = parseQuietHours("09:00-18:00")!;
  assert.equal(inQuietHours(at(12), day), true);
  assert.equal(inQuietHours(at(3), day), false);
});
