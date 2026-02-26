/**
 * metrics.ts
 * ──────────
 * In-memory metrics store. No external dependency needed.
 *
 * Why in-memory?
 *   For a simulator/demo this is fine. In production you'd push to
 *   Redis (for multi-instance) or Prometheus (for dashboards).
 *
 * P95 latency:
 *   Sort the latency array and take index at 95th percentile.
 *   This is more meaningful than average because it captures tail latency
 *   which is what students actually experience on slow requests.
 *
 * Bucketed time-series:
 *   We keep a rolling 60-bucket window (each bucket = 5 seconds).
 *   This lets us show "latency over time" on a dashboard without
 *   storing every single data point forever.
 */

import type { LogEntry, Complexity } from "./types.js";
import { rotationLog } from "./registery.js";

// ─── Per-model sub-metrics ────────────────────────────────────────────────────
interface ModelMetrics {
  requests: number;
  errors: number;
  totalLatency: number;
}

// ─── Time bucket for rolling window ──────────────────────────────────────────
interface TimeBucket {
  ts: number; // bucket start (unix ms)
  requests: number;
  errors: number;
  totalLatency: number;
}

const BUCKET_SIZE_MS = 5_000; // 5 second buckets
const MAX_BUCKETS = 120; // 10 minutes of history

export const logs: LogEntry[] = []; // raw log, last N entries

const latencies: number[] = []; // all latency values (for P95)
let totalRequests = 0;
let totalErrors = 0;

export const metrics = {
  models: {} as Record<string, ModelMetrics>,
  keys: {} as Record<string, number>, // keyId → usage count
  timeBuckets: [] as TimeBucket[],
};

export function logRequest(entry: LogEntry): void {
  if (logs.length >= 5000) logs.splice(0, 100);
  logs.push(entry);

  totalRequests++;
  if (!entry.ok) totalErrors++;
  latencies.push(entry.latencyMs);

  const m = (metrics.models[entry.model] ??= {
    requests: 0,
    errors: 0,
    totalLatency: 0,
  });
  m.requests++;
  if (!entry.ok) m.errors++;
  m.totalLatency += entry.latencyMs;

  metrics.keys[entry.keyId] = (metrics.keys[entry.keyId] ?? 0) + 1;

  const bucketTs = Math.floor(Date.now() / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
  const lastBucket = metrics.timeBuckets.at(-1);

  if (!lastBucket || lastBucket.ts !== bucketTs) {
    metrics.timeBuckets.push({
      ts: bucketTs,
      requests: 1,
      errors: entry.ok ? 0 : 1,
      totalLatency: entry.latencyMs,
    });
    if (metrics.timeBuckets.length > MAX_BUCKETS) metrics.timeBuckets.shift();
  } else {
    lastBucket.requests++;
    if (!entry.ok) lastBucket.errors++;
    lastBucket.totalLatency += entry.latencyMs;
  }
}

function calcP95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function calcAvg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function getStats() {
  const perModel: Record<
    string,
    {
      requests: number;
      errors: number;
      errorRate: string;
      avgLatencyMs: string;
    }
  > = {};

  for (const [name, m] of Object.entries(metrics.models)) {
    perModel[name] = {
      requests: m.requests,
      errors: m.errors,
      errorRate: ((m.errors / Math.max(m.requests, 1)) * 100).toFixed(1) + "%",
      avgLatencyMs: (m.totalLatency / Math.max(m.requests, 1)).toFixed(1),
    };
  }

  return {
    totalRequests,
    totalErrors,
    errorRate:
      ((totalErrors / Math.max(totalRequests, 1)) * 100).toFixed(2) + "%",
    avgLatencyMs: calcAvg(latencies).toFixed(1),
    p95LatencyMs: calcP95(latencies).toFixed(1),
    perModel,
    keyUsage: metrics.keys,
    timeBuckets: metrics.timeBuckets.map((b) => ({
      ts: b.ts,
      requests: b.requests,
      errorRate: ((b.errors / Math.max(b.requests, 1)) * 100).toFixed(1) + "%",
      avgLatencyMs: (b.totalLatency / Math.max(b.requests, 1)).toFixed(1),
    })),
    rotationEvents: rotationLog.slice(-20), // last 20 rotation events
  };
}

export function resetMetrics(): void {
  logs.length = 0;
  latencies.length = 0;
  totalRequests = 0;
  totalErrors = 0;
  for (const k of Object.keys(metrics.models)) delete metrics.models[k];
  for (const k of Object.keys(metrics.keys)) delete metrics.keys[k];
  metrics.timeBuckets.length = 0;
}
