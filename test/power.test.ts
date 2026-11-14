import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSudoList } from "../power.ts";
import { lastWakeKind } from "../core.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("sudo -l: the Vorssaint rule allows only toggling sleep", () => {
  assert.deepEqual(parseSudoList(fixture("sudo-l.txt")), { toggleSleep: true, wake: false, shutdown: false });
});

test("sudo -l: a password rule (ALL) ALL grants nothing", () => {
  assert.deepEqual(parseSudoList("User u may run the following commands on m:\n    (ALL) ALL\n"), {
    toggleSleep: false, wake: false, shutdown: false,
  });
});

test("sudo -l: the Mac Watch rule, wrapped over lines", () => {
  const text = [
    "User u may run the following commands on m:",
    "    (ALL) ALL",
    "    (root) NOPASSWD: /usr/bin/pmset disablesleep 0, /usr/bin/pmset disablesleep 1, /usr/bin/pmset relative",
    "        wake 3600, /usr/bin/pmset relative wake 14400, /usr/bin/pmset relative wake 28800, /sbin/shutdown -h now",
  ].join("\n");
  assert.deepEqual(parseSudoList(text), { toggleSleep: true, wake: true, shutdown: true });
  assert.deepEqual(parseSudoList("    (ALL) NOPASSWD: ALL"), { toggleSleep: true, wake: true, shutdown: true });
});

test("pmset log: DarkWake is not a real wake", () => {
  const log = [
    "2026-11-14 14:17:04 +0700 Sleep               \tEntering Sleep state due to 'Maintenance Sleep'",
    "2026-11-14 14:24:08 +0700 DarkWake            \tDarkWake from Deep Idle [CDNP] : due to rtc/Maintenance",
    "2026-11-14 14:36:32 +0700 Wake                \tWake from Deep Idle [CDNVA] : due to lid",
  ].join("\n");
  const at = (s: string) => Date.parse(s);
  assert.equal(lastWakeKind(log, at("2026-11-14T14:20:00+07:00")), "full");
  assert.equal(lastWakeKind(log.split("\n").slice(0, 2).join("\n"), at("2026-11-14T14:20:00+07:00")), "dark");
  assert.equal(lastWakeKind(log, at("2026-11-14T15:00:00+07:00")), null);
});
