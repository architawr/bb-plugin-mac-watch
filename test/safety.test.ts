import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveAlerts, parseBatterySafety, parseCondition, parseSmart, parseTemps, parseThermalPressure, type Snapshot,
} from "../core.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("temperature sensors: die max, SSD, battery; dead sensors ignored", () => {
  const t = parseTemps(fixture("temps.txt"));
  assert.ok(t && t.soc !== null && t.soc > 20 && t.soc < 110);
  assert.ok(t.ssd !== null && t.battery !== null);
  assert.deepEqual(parseTemps("PMU tdev1\t-22.0\nPMU tdie1\t47.5\n"), { soc: 47.5, socAvg: 47.5, ssd: null, battery: null });
  assert.equal(parseTemps(""), null);
});

test("thermal pressure, SMART, battery condition", () => {
  assert.equal(parseThermalPressure("com.apple.system.thermalpressurelevel 0\n"), 0);
  assert.equal(parseThermalPressure("garbage"), null);
  assert.equal(parseSmart("   SMART Status:              Verified\n"), "Verified");
  assert.equal(parseCondition("      Condition: Service Recommended\n"), "Service Recommended");
});

const ioreg = [
  '      "PermanentFailureStatus" = 0',
  '      "BatteryData" = {"CellVoltage"=(4364,4368,4366),"LifetimeData"={"MaximumTemperature"=40}}',
  '      "ChargerData" = {"TimeChargingThermallyLimited"=0,"ChargingCurrent"=0}',
].join("\n");

test("battery safety signals", () => {
  assert.deepEqual(parseBatterySafety(ioreg, "Normal"), {
    permanentFailure: 0, condition: "Normal", cellsMv: [4364, 4368, 4366], cellSpreadMv: 4, thermallyLimitedSec: 0, lifetimeMaxC: 40,
  });
  assert.equal(parseBatterySafety("", null), null);
});

const base: Snapshot = {
  at: Date.now(),
  host: { name: "Mac", model: "", os: "", cores: 10, uptimeSec: 1, lastSleepAt: null, lastWakeAt: null },
  cpu: { usage: 10, load: [1, 1, 1] },
  memory: null,
  disk: { total: 500e9, free: 180e9, used: 320e9, smart: "Verified" },
  power: null,
  network: null,
  sleep: null,
  thermal: null,
  thermalPressure: 0,
  temps: { soc: 45, socAvg: 43, ssd: 39, battery: 31 },
  batterySafety: parseBatterySafety(ioreg, "Normal"),
  panics: [],
  top: { cpu: [], memory: [] },
  missing: [],
};
const ids = (s: Snapshot, recent: Snapshot[] = []) => deriveAlerts(s, recent).map((a) => `${a.id}:${a.tone}`);

test("safety alerts stay quiet on a healthy Mac", () => {
  assert.deepEqual(ids({ ...base, sleep: null }), []);
});

test("safety alerts fire on danger", () => {
  assert.deepEqual(ids({ ...base, temps: { ...base.temps!, soc: 104 } }), ["soc-hot:bad"]);
  const warm = { ...base, temps: { ...base.temps!, soc: 92 } };
  assert.deepEqual(ids(warm, [warm, warm, warm]), ["soc-hot:warn"]);
  assert.deepEqual(ids({ ...base, thermalPressure: 3 }), ["thermal-pressure:bad"]);
  assert.deepEqual(ids({ ...base, batterySafety: { ...base.batterySafety!, permanentFailure: 2 } }), ["battery-failure:bad"]);
  assert.deepEqual(ids({ ...base, batterySafety: { ...base.batterySafety!, cellSpreadMv: 150 } }), ["battery-cells:warn"]);
  const limited = { ...base, batterySafety: { ...base.batterySafety!, thermallyLimitedSec: 30 } };
  assert.deepEqual(ids(limited, [base]), ["charge-hot:warn"]);
  assert.deepEqual(ids({ ...base, disk: { ...base.disk!, smart: "Failing" } }), ["smart:bad"]);
  assert.deepEqual(ids({ ...base, panics: [Date.now() - 3600_000] }), ["panic:warn"]);
});
