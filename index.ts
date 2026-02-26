/**
 * index.ts
 * ────────
 * Entry point. Two modes:
 *
 *   bun run src/index.ts            → starts HTTP server
 *   bun run src/index.ts simulate   → runs CLI simulator directly (no server)
 *
 * This lets you use the system both as an API and as a standalone simulator
 * without needing two separate entry files.
 */

import "dotenv/config";
import { initRegistry } from "./src/registery.ts";
import { startKeyManager } from "./src/keymngr.ts";
import { createServer } from "./src/server.ts";
import { runSimulator } from "./src/Simulator.ts";

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  // Bootstrap: init model registry with keys
  initRegistry();

  const mode = process.argv[2];

  if (mode === "simulate") {
    // ── CLI simulation mode ────────────────────────────────────────────────
    // Start key rotation in background even for CLI so rotation metrics show up
    startKeyManager();

    const totalUsers = Number(process.argv[3] ?? 1000);
    const concurrency = Number(process.argv[4] ?? 50);
    const policy = (process.argv[5] ?? "cost") as
      | "cost"
      | "latency"
      | "fallback";

    await runSimulator({ totalUsers, concurrency, policy });
    process.exit(0);
  } else {
    // ── HTTP server mode ───────────────────────────────────────────────────
    startKeyManager();
    const app = createServer();

    app.listen(PORT, () => {
      console.log(`\n LLM-Orc-Station running on http://localhost:${PORT}`);
      console.log(`   POST /query       → send a single query`);
      console.log(`   GET  /stats       → metrics snapshot`);
      console.log(`   GET  /keys        → key state per model`);
      console.log(`   POST /rotate/:model → manual key rotation`);
      console.log(`   POST /simulate    → start 1000-user simulation\n`);
    });
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
