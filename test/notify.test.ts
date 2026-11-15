import { test } from "node:test";
import assert from "node:assert/strict";
import { planNotifications, type Alert, type AlertPush, type NotifyState, type Tone } from "../core.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const COOLDOWN = { always: 30 * MIN, day: 6 * HOUR } as const;
const GAP = 15 * MIN;

const alert = (id: string, push: AlertPush, tone: Exclude<Tone, "good"> = "warn"): Alert => ({
  id, tone, push, title: `alert ${id}`, detail: "detail",
});

const fresh = (lastSentAt = -GAP): NotifyState => ({
  streak: new Map(), seen: new Map(), notified: {}, sent: new Set(), lastSentAt,
});

/** One 15-second sampling tick. */
const tick = (state: NotifyState, alerts: Alert[], now: number, quiet = false) =>
  planNotifications(alerts, state, { now, quiet, enabled: true, cooldown: COOLDOWN, gap: GAP });

/** Feed the same alert set for `span` ms at 15 s, collecting every notification. */
function run(alerts: Alert[], span: number, start = 0, state = fresh(), quietAt = (_: number) => false) {
  const sent: { id: string; at: number }[] = [];
  for (let now = start; now <= start + span; now += 15_000) {
    for (const n of tick(state, alerts, now, quietAt(now))) sent.push({ id: n.id, at: now });
  }
  return sent;
}

test("a night with the lid shut and a battery Mac says nothing at all", () => {
  // The reported bug: this used to produce a notification every ~70 minutes.
  const quietAt = (now: number) => {
    const hour = new Date(now).getHours();
    return hour >= 23 || hour < 9;
  };
  const night = [alert("memory", "day"), alert("ac-drain", "day")];
  const start = new Date(2026, 10, 14, 23, 0, 0).getTime();
  assert.deepEqual(run(night, 10 * HOUR - 15_000, start, fresh(), quietAt), []);
});

test("an alert has to hold for two samples", () => {
  const state = fresh();
  assert.deepEqual(tick(state, [alert("soc-hot", "always", "bad")], 0), []);
  assert.equal(tick(state, [alert("soc-hot", "always", "bad")], 15_000).length, 1);
});

test("day alerts wait out the quiet hours and go in the morning if still there", () => {
  const day = alert("memory", "day");
  const state = fresh();
  // 03:00 — nothing.
  for (let now = 3 * HOUR; now < 9 * HOUR; now += 15_000) assert.deepEqual(tick(state, [day], now, true), []);
  assert.equal(state.notified.memory, undefined);
  // 09:00 — the problem is still there, so it is reported now.
  assert.equal(tick(state, [day], 9 * HOUR).length, 1);
});

test("two alerts each on their own cooldown still cannot exceed one per gap", () => {
  const state = fresh();
  const sent: number[] = [];
  const both = () => [alert("memory", "day"), alert("ac-drain", "day")];
  for (let now = 12 * HOUR; now <= 12 * HOUR + 2 * HOUR; now += 15_000) {
    for (const n of tick(state, both(), now)) sent.push(now);
  }
  assert.ok(sent.length >= 1);
  for (let i = 1; i < sent.length; i += 1) assert.ok(sent[i]! - sent[i - 1]! >= GAP);
});

test("a reported bad alert gets one all-clear, an unremarkable one does not", () => {
  const state = fresh();
  const hot = alert("soc-hot", "always", "bad");
  tick(state, [hot], 0);
  assert.equal(tick(state, [hot], 15_000).length, 1);
  const clear = tick(state, [], 15_000 + GAP);
  assert.deepEqual(clear.map((n) => [n.id, n.title, n.body]), [["clear:soc-hot", "✅ Снова в норме", hot.title]]);
  assert.deepEqual(tick(state, [], 15_000 + 2 * GAP), []);

  // A warning that was pushed in the daytime does not get an all-clear.
  const warm = alert("memory", "day", "warn");
  const second = fresh();
  tick(second, [warm], 12 * HOUR);
  assert.equal(tick(second, [warm], 12 * HOUR + 15_000).length, 1);
  assert.deepEqual(tick(second, [], 12 * HOUR + 15_000 + GAP), []);
});

test("an all-clear stays quiet at night", () => {
  const state = fresh();
  const hot = alert("soc-hot", "always", "bad");
  tick(state, [hot], 0);
  assert.equal(tick(state, [hot], 15_000).length, 1);
  assert.deepEqual(tick(state, [], 15_000 + GAP, true), []);
  // ...and a repeat of the same alert after it comes back is still rate-limited by the cooldown.
  assert.deepEqual(tick(state, [hot], 15_000 + 5 * MIN), []);
});

test("notifications off means nothing goes out", () => {
  const state = fresh();
  const hot = alert("soc-hot", "always", "bad");
  const off = (now: number) => planNotifications([hot], state, { now, quiet: false, enabled: false, cooldown: COOLDOWN, gap: GAP });
  assert.deepEqual(off(0), []);
  assert.deepEqual(off(15_000), []);
});
