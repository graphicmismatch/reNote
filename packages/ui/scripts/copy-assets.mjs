import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// tsc only emits .ts/.tsx; CSS (and any future non-TS assets) need a
// separate copy step so the built package actually contains them.
// Plain Node fs APIs keep this cross-platform (Windows/macOS/Linux) without
// depending on a shell-specific `cp`.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const distDir = join(here, "..", "dist");

cpSync(srcDir, distDir, {
  recursive: true,
  filter: (source) => !/\.tsx?$/.test(source),
});
