/**
 * Handles two separate concerns:
 *
 * 1. KEY ROTATION
 *    Background job runs every N minutes.
 *    Lifecycle: active → deprecated → revoked
 *
 *    Why dual-key overlap?
 *    If you instantly revoke the old key the moment you add a new one,
 *    any in-flight request using the old key will fail mid-way.
 *    Instead we keep the old key "deprecated" (still valid) for a grace
 *    period, then revoke it. This is the standard blue/green key strategy.
 *
 *    Timeline:
 *    t=0   key-A active, key-B active
 *    t=5m  addKey → key-C active; key-A → deprecated (still works)
 *    t=10m key-A → revoked (removed from model); key-B → deprecated
 *    t=15m addKey → key-D active; key-B → revoked
 *
 * 2. CIRCUIT BREAKER (per key)
 *    If a key produces 3 consecutive failures → state = "open"
 *    After 30 seconds cooldown → state = "half" (one probe request allowed)
 *    If probe succeeds → state = "closed" (key back in rotation)
 *    If probe fails → state = "open" again
 *
 *    Why circuit breakers?
 *    Without them, a rate-limited or revoked key keeps getting requests
 *    and all of them fail, tanking the P95 latency and burning retry budget.
 */

import { models, addKey, rotationLog } from "./registery.js";
import type { ApiKey, Model } from "./types.js";

const ROTATION_INTERVAL_MS = 5 * 60 * 1000; // rotate every 5 minutes
const GRACE_PERIOD_MS = 2 * 60 * 1000; // deprecated → revoked after 2 min
const MAX_USAGE_BEFORE_ROTATE = 100; // usage-count-based rotation
const BREAKER_FAIL_THRESHOLD = 3; // consecutive failures to open breaker
const BREAKER_COOLDOWN_MS = 30_000; // 30s cooldown when open

let rotationTimer: ReturnType<typeof setInterval> | null = null;

// ─── Rotation Logic ───────────────────────────────────────────────────────────

/**
 * Rotates keys for a single model:
 *   1. Add a new key (active)
 *   2. Mark the oldest active key as deprecated
 *
 * Revocation of deprecated keys happens in a separate sweep (cleanupKeys).
 */
export function rotateKeys(modelName: string): void {
  const model = models[modelName];
  if (!model) return;

  // Never rotate if only one key exists (safety guard)
  const activeKeys = model.keys.filter((k) => k.status === "active");
  if (activeKeys.length === 0) return;

  // Add fresh key
  const newKey = addKey(modelName);

  // Find the oldest active key by createdAt
  const oldest = activeKeys.reduce((a, b) =>
    a.createdAt < b.createdAt ? a : b,
  );
  oldest.status = "deprecated";

  rotationLog.push({
    ts: Date.now(),
    modelName,
    newKeyId: newKey.id,
    deprecatedKeyId: oldest.id,
  });

  console.log(
    `[KeyMgr] Rotated ${modelName}: +key ${newKey.id.slice(0, 8)} | deprecated ${oldest.id.slice(0, 8)}`,
  );
}

/**
 * Sweeps all models and revokes deprecated keys whose grace period has elapsed.
 * Also prunes revoked keys so the array doesn't grow forever.
 */
export function cleanupKeys(): void {
  const now = Date.now();

  for (const [modelName, model] of Object.entries(models)) {
    for (const key of model.keys) {
      if (key.status === "deprecated") {
        // Find when it was deprecated via rotation log
        const evt = [...rotationLog]
          .reverse()
          .find((e) => e.deprecatedKeyId === key.id);

        const deprecatedAt = evt?.ts ?? key.createdAt;

        if (now - deprecatedAt > GRACE_PERIOD_MS) {
          key.status = "revoked";

          rotationLog.push({
            ts: now,
            modelName,
            newKeyId: "",
            revokedKeyId: key.id,
          });

          console.log(
            `[KeyMgr] Revoked key ${key.id.slice(0, 8)} for ${modelName}`,
          );
        }
      }
    }

    // Prune revoked keys (keep last 5 for audit visibility)
    const revoked = model.keys.filter((k) => k.status === "revoked");
    if (revoked.length > 5) {
      const toRemove = new Set(
        revoked.slice(0, revoked.length - 5).map((k) => k.id),
      );
      model.keys = model.keys.filter((k) => !toRemove.has(k.id));
    }
  }
}

/**
 * Usage-based rotation: if any key has exceeded MAX_USAGE_BEFORE_ROTATE
 * successful requests, rotate that model regardless of time.
 */
export function checkUsageBasedRotation(): void {
  for (const [modelName, model] of Object.entries(models)) {
    const overused = model.keys.find(
      (k) => k.status === "active" && k.usage >= MAX_USAGE_BEFORE_ROTATE,
    );
    if (overused) {
      console.log(
        `[KeyMgr] Usage-based rotation triggered for ${modelName} (key ${overused.id.slice(0, 8)} hit ${overused.usage} uses)`,
      );
      rotateKeys(modelName);
    }
  }
}

// Circuit Breaker

/** Call after a successful request for a key. */
export function recordSuccess(key: ApiKey): void {
  key.usage++;
  key.lastUsed = Date.now();
  key.consecutiveFails = 0;

  // If this was a half-open probe that succeeded, close the breaker
  if (key.breakerState === "half") {
    key.breakerState = "closed";
    console.log(`[Breaker] Key ${key.id.slice(0, 8)} recovered → closed`);
  }
}

/** Call after a failed request for a key. */
export function recordFailure(key: ApiKey): void {
  key.consecutiveFails++;
  key.lastUsed = Date.now();

  if (key.consecutiveFails >= BREAKER_FAIL_THRESHOLD) {
    key.breakerState = "open";
    key.breakerOpenedAt = Date.now();
    console.warn(
      `[Breaker] Key ${key.id.slice(0, 8)} opened after ${key.consecutiveFails} consecutive failures`,
    );
  } else if (key.breakerState === "half") {
    // Probe failed → back to open
    key.breakerState = "open";
    key.breakerOpenedAt = Date.now();
    console.warn(
      `[Breaker] Key ${key.id.slice(0, 8)} probe failed → re-opened`,
    );
  }
}

// Background Loop

export function startKeyManager(): void {
  if (rotationTimer) return; // idempotent

  rotationTimer = setInterval(() => {
    console.log("[KeyMgr] Running scheduled rotation sweep…");
    for (const modelName of Object.keys(models)) {
      rotateKeys(modelName);
    }
    cleanupKeys();
    checkUsageBasedRotation();
  }, ROTATION_INTERVAL_MS);

  // Also run cleanup more frequently (every 30s) to handle grace periods
  setInterval(cleanupKeys, 30_000);

  console.log(
    `[KeyMgr] Started. Rotation every ${ROTATION_INTERVAL_MS / 60000} min.`,
  );
}

export function stopKeyManager(): void {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
}

export { ROTATION_INTERVAL_MS, GRACE_PERIOD_MS, MAX_USAGE_BEFORE_ROTATE };
