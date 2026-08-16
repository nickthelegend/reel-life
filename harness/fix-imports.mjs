// Emitted ESM uses extensionless specifiers; browsers need explicit paths.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!path.endsWith(".js")) continue;
    const src = readFileSync(path, "utf8");
    const out = src.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
      (m, a, spec, b) => (spec.endsWith(".js") ? m : `${a}${spec}.js${b}`));
    if (out !== src) writeFileSync(path, out);
  }
}
walk(join(dirname(fileURLToPath(import.meta.url)), "dist"));
console.log("import specifiers rewritten");
