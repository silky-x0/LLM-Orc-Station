/**
 * orchestrator.ts
 * ───────────────
 * Ties all the pieces together for a single query.
 *
 * Flow:
 *   1. Classify prompt complexity
 *   2. Route to model+key based on policy
 *   3. Dispatch the call (real or mock)
 *   4. Record outcome (success/failure) for circuit breaker
 *   5. Log metrics
 *   6. Return result
 *
 * Retry behaviour:
 *   If a model call fails, we immediately retry with a DIFFERENT model
 *   (not the same key — that would just hit the breaker again).
 *   We try at most 2 retries so the total attempt count is 3.
 *   Each retry uses the "fallback" policy to pick the healthiest remaining model.
 *
 * Why not retry the same key?
 *   A failure is usually caused by rate limiting or a bad key.
 *   Retrying the same key wastes time and makes the breaker worse.
 */

import { classifyPrompt } from "./classifier.js";
import { route } from "./router.js";
import { callModel } from "./dispatcher.js";
import { recordSuccess, recordFailure } from "./keymngr.js";
import { logRequest } from "./metrics.js";
import type { QueryRequest, QueryResponse, LogEntry, Policy } from "./types.js";

const MAX_RETRIES = 2;

export async function handleQuery(req: QueryRequest): Promise<QueryResponse> {
  const policy: Policy = req.policy ?? "cost";
  const complexity = classifyPrompt(req.prompt);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // On retries, use fallback policy to find healthiest available model
    const effectivePolicy: Policy = attempt === 0 ? policy : "fallback";

    let model, key;
    try {
      ({ model, key } = route(complexity, effectivePolicy));
    } catch (err) {
      // No model available at all
      break;
    }

    const start = Date.now();
    let ok = false;
    let responseText = "";
    let errorMsg: string | undefined;

    try {
      const result = await callModel(model, key, req.prompt);
      responseText = result.text;
      ok = true;
      recordSuccess(key);
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(errorMsg);
      recordFailure(key);
      console.warn(`[Orchestrator] Attempt ${attempt + 1} failed: ${errorMsg}`);
    }

    const latencyMs = Date.now() - start;

    const logEntry: LogEntry = {
      ts:         Date.now(),
      userId:     req.userId,
      persona:    req.persona,
      prompt:     req.prompt.slice(0, 120), // truncate for log storage
      complexity,
      model:      model.name,
      keyId:      key.id,
      latencyMs,
      ok,
      errorMsg,
    };

    logRequest(logEntry);

    if (ok) {
      return {
        model:      model.name,
        keyId:      key.id,
        latencyMs,
        complexity,
        response:   responseText,
        ok:         true,
      };
    }
  }

  // All retries exhausted
  return {
    model:      "none",
    keyId:      "none",
    latencyMs:  0,
    complexity,
    response:   `Error: ${lastError?.message ?? "Unknown failure"}`,
    ok:         false,
  };
}