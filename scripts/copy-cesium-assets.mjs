/**
 * Copies Cesium's static runtime files (Workers, Assets, ThirdParty, Widgets) into public/cesium,
 * where the bundled Cesium module loads them from CESIUM_BASE_URL ("/cesium/").
 * Runs before `next dev` / `next build` and after `npm install`; skips the copy when the
 * installed version is already there.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "cesium", "Build", "Cesium");
const target = join(root, "public", "cesium");
const stamp = join(target, ".version");

if (!existsSync(source)) {
  console.warn("[cesium] node_modules/cesium not found, skipping asset copy.");
  process.exit(0);
}

const { version } = JSON.parse(
  readFileSync(join(root, "node_modules", "cesium", "package.json"), "utf8"),
);

if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const folder of ["Workers", "Assets", "ThirdParty", "Widgets"]) {
  cpSync(join(source, folder), join(target, folder), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`[cesium] Copied Cesium ${version} static assets to public/cesium`);
