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
- `alerts` — `[{id, tone: "warn" | "bad", title, detail, push: "always" | "day"}]`.
  `push` is when it may reach the phone: `always` at any hour, `day` only
  outside the quiet hours. Only real trouble is an alert at all: running on
  battery (above 20%), a closed lid, a Mac free to sleep and high load are not.
- `verdict` — `{tone, title, detail}`: will the Mac stay awake.

Notes for answering:

- The plugin samples every 15 seconds while BB runs and keeps 24 hours of history
  locally. Sampling reads only stock macOS tools and never uses sudo.
- `power.batteryWatts` is negative while the battery drains. On AC power a
  negative value means the adapter is too weak (alert `ac-drain`).
- `sleep.sleepDisabled` is the system-wide `pmset disablesleep` flag: with it the
  Mac stays awake even with the lid closed. `sleep.holders` lists processes that
  hold idle-sleep or display-sleep assertions; the plugin does not depend on any
  particular keep-awake app.
- CPU of processes is percent of one core; helpers are grouped under their app.
- Safety fields: `temps` (`soc`, `ssd`, `battery` °C from HID sensors, no root),
  `thermalPressure` (0 nominal … 3+ critical), `batterySafety` (`permanentFailure`
  non-zero = the battery controller reports a fault; `condition`; `cellSpreadMv`,
  healthy is a few mV; `thermallyLimitedSec`; `lifetimeMaxC`), `disk.smart`,
  `panics` (kernel panic times, last 7 days). Swelling cannot be measured directly.
- Alerts are pushed to the user's phone through the push-notifications plugin
  after they hold for two samples. `day` alerts wait for the morning during the
  quiet hours (setting `quiet`, default `23:00-09:00`, `off` disables them).
  Repeats stop at one per 30 min for `always` and one per 6 h for `day`, with at
  most one notification per 15 min overall. Only heat, a battery under 20%, memory
  and disk pressure, SMART, a battery-controller fault, a kernel panic and an
  unexpected reboot alert at all; battery power, a closed lid and high load do
  not. An unexpected reboot shows up as alert `restart` for 24 h.
- If the Mac dies or loses power and network, the plugin dies with it and cannot
  report it; the page then simply stops updating.

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
