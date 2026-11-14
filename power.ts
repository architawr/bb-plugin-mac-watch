// Power actions: turn the display off, put the Mac to sleep, shut it down.
//
// Works at the macOS level, not through any keep-awake app. If sleep is
// disabled system-wide (`pmset disablesleep 1`, set by apps like Vorssaint or
// Amphetamine for closed-lid use), we clear it for the nap and set it back after
// waking, but only if something still holds the Mac awake. Commands that need
// root run through `sudo -n` and work only when a NOPASSWD rule allows them.
import { execFile } from "node:child_process";
import { lastWakeKind, parseAssertions, parsePmsetSettings, parseKernTime } from "./core.ts";

export const WAKE_HOURS = [1, 4, 8] as const;
export type WakeHours = (typeof WAKE_HOURS)[number];

export const COMMANDS = {
  sleepOff: ["/usr/bin/pmset", "disablesleep", "0"],
  sleepOn: ["/usr/bin/pmset", "disablesleep", "1"],
  shutdown: ["/sbin/shutdown", "-h", "now"],
  wake: (hours: WakeHours) => ["/usr/bin/pmset", "relative", "wake", String(hours * 3600)],
} as const;

export type Privileges = { toggleSleep: boolean; wake: boolean; shutdown: boolean };

/** What survives a plugin restart while the Mac sleeps. */
export type PendingSleep = { at: number; restoreSleepDisabled: boolean; wakeHours: WakeHours | null };

function run(file: string, args: readonly string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout, env: { ...process.env, LANG: "C" } }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
}

const sudo = (command: readonly string[]) => run("/usr/bin/sudo", ["-n", ...command]);

/**
 * Which root commands run without a password. `sudo -l` lists every rule, with or
 * without NOPASSWD, so read the NOPASSWD entries themselves.
 */
export function parseSudoList(text: string): Privileges {
  const flat = text.replace(/\n\s+/g, " ");
  const allowed: string[] = [];
  for (const match of flat.matchAll(/NOPASSWD:\s*([^\n]*?)(?=\s+\([^)]*\)\s|$)/gm)) {
    allowed.push(...match[1]!.split(",").map((c) => c.trim().replace(/\s+/g, " ")));
  }
  const can = (command: readonly string[]) => allowed.includes("ALL") || allowed.includes(command.join(" "));
  return {
    toggleSleep: can(COMMANDS.sleepOff) && can(COMMANDS.sleepOn),
    wake: WAKE_HOURS.every((h) => can(COMMANDS.wake(h))),
    shutdown: can(COMMANDS.shutdown),
  };
}

let cached: { at: number; value: Privileges } | null = null;
export async function privileges(force = false): Promise<Privileges> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.value;
  const text = await run("/usr/bin/sudo", ["-n", "-l"]).catch(() => "");
  cached = { at: Date.now(), value: parseSudoList(text) };
  return cached.value;
}

/** Let the RPC answer reach the phone before the Mac goes dark. */
const soon = (fn: () => Promise<unknown>, log: (m: string) => void) =>
  setTimeout(() => { fn().catch((e) => log(String(e instanceof Error ? e.message : e))); }, 2500);

export async function displayOff(): Promise<void> {
  await run("/usr/bin/pmset", ["displaysleepnow"]);
}

/**
 * Validates everything up front and throws a readable error, so the page can
 * explain the refusal. The actual sleep happens a moment after we return.
 */
export async function sleep(
  wakeHours: WakeHours | null,
  save: (pending: PendingSleep) => Promise<void>,
  log: (m: string) => void,
): Promise<PendingSleep> {
  const p = await privileges(true);
  const { sleepDisabled } = parsePmsetSettings(await run("/usr/bin/pmset", ["-g"]));
  if (sleepDisabled && !p.toggleSleep) {
    throw new Error("Сон запрещён системно (pmset disablesleep 1), а снять запрет без пароля нельзя. Установите правило sudo.");
  }
  if (wakeHours && !p.wake) {
    throw new Error("Пробуждение по таймеру требует правила sudo. Можно усыпить без таймера.");
  }
  const pending: PendingSleep = { at: Date.now(), restoreSleepDisabled: sleepDisabled, wakeHours };
  await save(pending);
  soon(async () => {
    if (wakeHours) await sudo(COMMANDS.wake(wakeHours));
    if (sleepDisabled) await sudo(COMMANDS.sleepOff);
    try {
      await run("/usr/bin/pmset", ["sleepnow"]);
    } catch (error) {
      // Put the guard back right away if the nap never started.
      if (sleepDisabled) await sudo(COMMANDS.sleepOn).catch(() => undefined);
      throw error;
    }
  }, log);
  return pending;
}

export async function shutdown(log: (m: string) => void): Promise<void> {
  const p = await privileges(true);
  if (!p.shutdown) throw new Error("Выключение требует правила sudo для /sbin/shutdown -h now.");
  soon(() => sudo(COMMANDS.shutdown), log);
}

/**
 * Called on every sample while a sleep is pending. After the Mac wakes (or if it
 * never fell asleep), set `disablesleep 1` back when a non-system process still
 * keeps the Mac awake; otherwise leave the system default.
 * Returns a note for the log, or null while still waiting.
 */
export async function settleAfterSleep(pending: PendingSleep): Promise<string | null> {
  const now = Date.now();
  const sysctl = await run("/usr/sbin/sysctl", ["-n", "kern.waketime"]).catch(() => "");
  const wokeAt = parseKernTime(sysctl);
  const woke = wokeAt !== null && wokeAt > pending.at;
  const gaveUp = !woke && now - pending.at > 90_000;
  if (!woke && !gaveUp) return null;
  if (woke && pending.restoreSleepDisabled) {
    // Maintenance DarkWakes happen with the lid closed; restoring the guard then
    // would keep a Mac awake that was put to sleep on purpose. Wait for a real
    // wake, or for the timer the user chose.
    const timerDue = pending.wakeHours !== null && now >= pending.at + pending.wakeHours * 3600_000 - 120_000;
    const log = await run("/bin/sh", ["-c", "/usr/bin/pmset -g log | /usr/bin/tail -c 400000"], 20_000).catch(() => "");
    if (!timerDue && lastWakeKind(log, pending.at) !== "full") return null;
  }
  if (!pending.restoreSleepDisabled) return woke ? "Мак проснулся." : "Мак не уснул.";
  const { holders } = parseAssertions(await run("/usr/bin/pmset", ["-g", "assertions"]).catch(() => ""));
  const keeper = holders.find((h) => h.type === "PreventUserIdleSystemSleep" && !SYSTEM.has(h.process));
  if (!keeper) return `${woke ? "Мак проснулся" : "Мак не уснул"}; запрет сна не возвращаю: никто не держит Мак бодрым.`;
  await sudo(COMMANDS.sleepOn);
  return `${woke ? "Мак проснулся" : "Мак не уснул"}; запрет сна возвращён (держит ${keeper.process}).`;
}

const SYSTEM = new Set(["powerd", "sharingd", "coreaudiod", "WindowServer", "backupd", "useractivityd", "bluetoothd"]);
