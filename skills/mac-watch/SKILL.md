---
name: mac-watch
description: Check the health of the Mac that runs this BB server — CPU, memory pressure, disk, battery and power draw, and whether the Mac will stay awake (lid, SleepDisabled, who holds sleep assertions). Use when the user asks how their Mac or "the computer at home" is doing, why it is slow, whether it will fall asleep, or whether it is on battery.
---

# Mac Watch

`bb mac-watch status` prints a short Russian summary of the latest sample:
host and uptime, sleep verdict, CPU and load, memory and pressure, disk free,
power source and draw, network rate, and current alerts.

`bb mac-watch status --json` returns one bounded JSON object:

- `snapshot` — the latest sample (`cpu`, `memory`, `disk`, `power`, `network`,
  `sleep`, `thermal`, `top.cpu`, `top.memory`, `host`), or `null` before the first one.
- `alerts` — `[{id, tone: "warn" | "bad", title, detail}]`.
- `verdict` — `{tone, title, detail}`: will the Mac stay awake.

Notes for answering:

- The plugin samples every 15 seconds while BB runs and keeps 24 hours of history
  locally. It reads only stock macOS tools and never uses sudo.
- `power.batteryWatts` is negative while the battery drains. On AC power a
  negative value means the adapter is too weak (alert `ac-drain`).
- `sleep.sleepDisabled` is the system-wide `pmset disablesleep` flag: with it the
  Mac stays awake even with the lid closed. `sleep.holders` lists processes that
  hold idle-sleep or display-sleep assertions; the plugin does not depend on any
  particular keep-awake app.
- CPU of processes is percent of one core; helpers are grouped under their app.

## Power actions

Run these only when the user explicitly asks; sleep and shutdown cut the Mac off
from BB, and this thread with it.

- `bb mac-watch display-off` — turn the display off. Any touch wakes it again.
- `bb mac-watch sleep --yes [--wake 1|4|8]` — sleep now. Nobody can wake it remotely,
  only a timer (`--wake`, needs the sudo rule), the lid or a key. If sleep was
  disabled system-wide, the plugin clears it for the nap and sets it back after a
  full wake (not a maintenance DarkWake) while some app still keeps the Mac awake.
- `bb mac-watch shutdown --yes` — power off; only the power button turns it back on.
  There is no restart on purpose: with FileVault on, the Mac stops at the unlock
  screen and BB would not come back.

Root commands go through `sudo -n` and need the NOPASSWD rule from
`sudoers/install.sh` in the plugin folder, which the user runs once on the Mac.

The full dashboard is the **Mac Watch** page in the BB sidebar.
