// App icons for the process lists: read the bundle's .icns and scale it to a
// small PNG with the stock `sips` tool. Results are cached for the plugin's life.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

const cache = new Map<string, Promise<string | null>>();

async function extract(app: string): Promise<string | null> {
  const plist = join(app, "Contents", "Info.plist");
  const name = (await run("/usr/bin/plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist]).catch(() => "")).trim();
  if (!name) return null; // Icon only in Assets.car: the page falls back to a letter.
  const icns = join(app, "Contents", "Resources", name.endsWith(".icns") ? name : `${name}.icns`);
  const dir = await mkdtemp(join(tmpdir(), "mac-watch-icon-"));
  try {
    const out = join(dir, "icon.png");
    await run("/usr/bin/sips", ["-s", "format", "png", "-Z", "64", icns, "--out", out]);
    const png = await readFile(out);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Only call with bundle paths the collector itself reported. */
export function appIcon(app: string): Promise<string | null> {
  let icon = cache.get(app);
  if (!icon) {
    icon = extract(app).catch(() => null);
    cache.set(app, icon);
  }
  return icon;
}
