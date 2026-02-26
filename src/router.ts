/**
 * Selects which model to use for a given request.
 *
 * Three policies:
 *
 * 1. cost  (default)
 *    Goal: cheapest model that can handle the complexity.
 *    Map:  simple → mock, medium → flash, complex → pro
 *    Fallback chain: if chosen model has no usable keys, escalate to next tier.
 *
 * 2. latency
 *    Goal: fastest response. Picks model with lowest avgLatency that has keys.
 *
 * 3. fallback
 *    Goal: maximum availability. Scores by usableKeys × (1 - errorRate).
 *
 * Edge cases:
 *   - Chosen model has no usable keys → escalate automatically.
 *   - All models degraded             → throw → orchestrator returns 503.
 *   - mock always has synthetic keys  → ultimate escape hatch.
 */

import { models, pickKey } from "./registery.js";
import { metrics } from "./metrics.js";
import type { Complexity, Policy, Model, ApiKey } from "./types.js";

const COST_PREFERENCE: Record<Complexity, string[]> = {
  simple: ["mock", "flash", "pro"],
  medium: ["flash", "pro", "mock"],
  complex: ["pro", "flash", "mock"],
};

export interface RouteResult {
  model: Model;
  key: ApiKey;
}

export function route(complexity: Complexity, policy: Policy): RouteResult {
  switch (policy) {
    case "cost":
      return routeByCost(complexity);
    case "latency":
      return routeByLatency();
    case "fallback":
      return routeByFallback();
    default:
      return routeByCost(complexity);
  }
}

function routeByCost(complexity: Complexity): RouteResult {
  const preference = COST_PREFERENCE[complexity];
  for (const modelKey of preference) {
    const model = models[modelKey];
    if (!model) continue;
    const key = pickKey(model);
    if (key) return { model, key };
    console.warn(
      `[Router] cost: ${model.name} has no usable keys → escalating`,
    );
  }
  throw new Error("No available model with usable keys (cost policy)");
}

function routeByLatency(): RouteResult {
  const sorted = Object.values(models).sort(
    (a, b) => a.avgLatency - b.avgLatency,
  );
  for (const model of sorted) {
    const key = pickKey(model);
    if (key) return { model, key };
  }
  throw new Error("No available model with usable keys (latency policy)");
}

function routeByFallback(): RouteResult {
  const scored = Object.values(models).map((model) => {
    const usableCount = model.keys.filter(
      (k) => k.status !== "revoked" && k.breakerState !== "open",
    ).length;
    const modelMetrics = metrics.models[model.name];
    const errorRate = modelMetrics
      ? modelMetrics.errors / Math.max(modelMetrics.requests, 1)
      : 0;
    return { model, score: usableCount * (1 - errorRate) };
  });

  scored.sort((a, b) => b.score - a.score);

  for (const { model } of scored) {
    const key = pickKey(model);
    if (key) return { model, key };
  }
  throw new Error("All models degraded — no usable keys (fallback policy)");
}
