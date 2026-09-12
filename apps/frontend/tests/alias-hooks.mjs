// Teach `node --test` the "@/*" -> "./src/*" alias from tsconfig.json.
//
// Source files import each other as "@/lib/...". Next/tsc resolve that from
// compilerOptions.paths, but Node's ESM loader has no such mapping, so any test
// reaching a module that uses the alias died with ERR_MODULE_NOT_FOUND —
// a harness gap, not a product bug.
//
// Uses the built-in synchronous module hooks (node:module registerHooks,
// Node >=22.15), so there's no loader dependency to install.
//
// Usage: node --import ./tests/alias-hooks.mjs --test "tests/*.test.ts"
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

// Order matters: the bare path wins only if it's a real file, so "@/lib/audit"
// prefers audit.ts over an audit/ directory's index.
const CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".json", "/index.ts", "/index.tsx"];

const isFile = (url) => {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = new URL(specifier.slice(2), SRC);
    for (const ext of CANDIDATES) {
      const candidate = new URL(base.href + ext);
      if (isFile(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    // Unmapped: let Node report the original specifier rather than a rewritten one.
    return nextResolve(specifier, context);
  },
});
