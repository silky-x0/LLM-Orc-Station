/**
 * Thin HTTP layer over the orchestrator.
 * Keeps routing logic out of here — server only parses request and formats response.
 *
 * Endpoints:
 *   POST /query      → single query
 *   GET  /stats      → metrics snapshot
 *   POST /simulate   → kick off simulator (non-blocking)
 *   GET  /keys       → view current key state per model
 *   POST /rotate/:model → manually trigger key rotation
 */

import express from "express";
import { handleQuery } from "./Orchestrator.js";
import { getStats, resetMetrics } from "./metrics.js";
import { models } from "./registery.js";
import { rotateKeys, cleanupKeys } from "./keymngr.js";
import { runSimulator } from "./Simulator.js";
import type { Policy, QueryRequest } from "./types.js";

export function createServer() {
  const app = express();
  app.use(express.json());

  // POST /query
  app.post("/query", async (req, res) => {
    const { prompt, userId, persona, policy } = req.body as Partial<
      QueryRequest & { policy: Policy }
    >;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const result = await handleQuery({
      userId: userId ?? "anonymous",
      persona: persona ?? "unknown",
      prompt,
      policy: policy ?? "cost",
    });

    res.status(result.ok ? 200 : 502).json(result);
  });

  // GET /stats
  app.get("/stats", (_req, res) => {
    res.json(getStats());
  });

  //GET /stats/reset
  app.post("/stats/reset", (_req, res) => {
    resetMetrics();
    res.json({ ok: true, message: "Metrics reset" });
  });

  //GET /keys
  app.get("/keys", (_req, res) => {
    const result: Record<string, unknown[]> = {};
    for (const [name, model] of Object.entries(models)) {
      result[name] = model.keys.map((k) => ({
        id: k.id.slice(0, 16),
        status: k.status,
        breakerState: k.breakerState,
        usage: k.usage,
        consecutiveFails: k.consecutiveFails,
        createdAt: new Date(k.createdAt).toISOString(),
        lastUsed: k.lastUsed ? new Date(k.lastUsed).toISOString() : "never",
      }));
    }
    res.json(result);
  });

  //POST /rotate/:model
  app.post("/rotate/:model", (req, res) => {
    const { model } = req.params as { model: string };
    if (!models[model]) {
      res.status(404).json({ error: `Unknown model: ${model}` });
      return;
    }
    rotateKeys(model);
    cleanupKeys();
    res.json({ ok: true, message: `Rotated keys for ${model}` });
  });

  app.post("/simulate", (req, res) => {
    const {
      users = 1000,
      policy = "cost",
      concurrency = 50,
    } = req.body as {
      users?: number;
      policy?: Policy;
      concurrency?: number;
    };

    // Fire and forget
    runSimulator({ totalUsers: users, policy, concurrency }).catch(
      console.error,
    );

    res.json({
      ok: true,
      message: `Simulation started for ${users} users. Poll GET /stats for progress.`,
    });
  });

  return app;
}
