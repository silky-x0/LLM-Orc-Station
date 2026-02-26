/**
 * Simulates 1,000+ school students sending queries to the orchestrator.
 *
 * Design decisions:
 *
 * 1. CONCURRENCY via Promise pools
 *    We don't fire all 1000 users at once (that would spike memory and
 *    overwhelm even a mock server). Instead we use a concurrency pool of
 *    N=50 concurrent "virtual users". As each one finishes, the next starts.
 *    This mimics real load patterns and keeps the process stable.
 *
 * 2. PERSONAS
 *    Each user is assigned a persona (grade-school, middle, high-school, teacher).
 *    Personas determine the prompt bank they draw from. This naturally creates
 *    a realistic complexity distribution: ~40% simple, ~40% medium, ~20% complex.
 *
 * 3. THINK TIME
 *    Between each query a user "thinks" for 500ms–2000ms (random).
 *    This models realistic pacing — students don't instantly re-submit.
 *
 * 4. WAVE STRUCTURE
 *    Users are released in waves every 2 seconds (simulates class periods
 *    where students start tasks at different times).
 *
 * 5. METRICS REPORTING
 *    Prints a live progress counter every 100 completed requests, and a
 *    full summary table at the end.
 */

import { handleQuery } from "./Orchestrator.js";
import { getStats, resetMetrics } from "./metrics.js";
import type { Policy } from "./types.js";

// ─── Prompt Banks by Persona ──────────────────────────────────────────────────
// Varied so complexity classifier gets a realistic workout

const PROMPTS: Record<string, string[]> = {
  "grade-school": [
    "What is 7 times 8?",
    "What is the capital of France?",
    "How do plants make food?",
    "What is a mammal?",
    "What does the sun do?",
    "Why is the sky blue?",
    "What is 144 divided by 12?",
    "Name three types of clouds.",
  ],
  "middle-school": [
    "Explain how photosynthesis works.",
    "Describe the water cycle.",
    "What caused World War 1?",
    "How do vaccines work?",
    "Explain Newton's first law of motion.",
    "What is the difference between a democracy and a monarchy?",
    "Summarise the plot of Romeo and Juliet.",
    "Write a Python function that reverses a string.",
  ],
  "high-school": [
    "Analyse the themes of power and corruption in Macbeth.",
    "Compare and contrast mitosis and meiosis with diagrams.",
    "Evaluate the economic causes of the Great Depression.",
    "Explain how recursion works and write a recursive Fibonacci algorithm.",
    "Discuss the ethical implications of genetic engineering in humans.",
    "Derive the quadratic formula from first principles.",
    "Compare Keynesian and supply-side economics.",
    "Write a detailed essay arguing for or against nuclear energy.",
  ],
  "teacher": [
    "Create a 10-question quiz on the American Civil War.",
    "Explain differentiated instruction strategies for a mixed-ability class.",
    "Summarise recent research on growth mindset in education.",
    "Help me design a rubric for evaluating student essays.",
  ],
};

const PERSONAS = Object.keys(PROMPTS) as Array<keyof typeof PROMPTS>;

// ─── Simulator Config ─────────────────────────────────────────────────────────
export interface SimulatorConfig {
  totalUsers:     number;   // default: 1000
  queriesPerUser: number;   // default: 3–5 (randomised)
  concurrency:    number;   // default: 50
  policy:         Policy;   // default: "cost"
  durationMs?:    number;   // optional: spread load over this window
}

const DEFAULTS: SimulatorConfig = {
  totalUsers:     1000,
  queriesPerUser: 4,
  concurrency:    50,
  policy:         "cost",
};

// ─── Progress Tracking ────────────────────────────────────────────────────────
let completed = 0;
let failed    = 0;
const startTime = { val: 0 };

function progressBar(done: number, total: number): string {
  const pct  = Math.round((done / total) * 40);
  const bar  = "█".repeat(pct) + "░".repeat(40 - pct);
  const perc = ((done / total) * 100).toFixed(1);
  return `[${bar}] ${perc}% (${done}/${total})`;
}

// ─── Single User Simulation ───────────────────────────────────────────────────
async function simulateUser(
  userId: string,
  persona: string,
  queriesPerUser: number,
  policy: Policy,
  totalQueries: number
): Promise<void> {
  const prompts = PROMPTS[persona] ?? PROMPTS["middle-school"]!;
  const numQueries = Math.floor(Math.random() * 3) + queriesPerUser - 1; // ±1

  for (let q = 0; q < numQueries; q++) {
    const prompt = prompts[Math.floor(Math.random() * prompts.length)]!;

    try {
      await handleQuery({ userId, persona, prompt, policy });
    } catch {
      failed++;
    }

    completed++;

    // Print progress every 100 completions
    if (completed % 100 === 0) {
      const elapsed = ((Date.now() - startTime.val) / 1000).toFixed(1);
      process.stdout.write(
        `\r${progressBar(completed, totalQueries)}  elapsed: ${elapsed}s`
      );
    }

    // Think time between queries
    const thinkTime = 500 + Math.random() * 1500;
    await sleep(thinkTime);
  }
}

// ─── Concurrency Pool ─────────────────────────────────────────────────────────
// Runs at most `limit` promises concurrently.
async function runPool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  const queue = [...tasks];
  const active: Promise<void>[] = [];

  async function runNext(): Promise<void> {
    const task = queue.shift();
    if (!task) return;
    await task();
    await runNext();
  }

  // Seed the pool with `limit` initial tasks
  const seeds = Array.from({ length: Math.min(limit, queue.length + active.length) }, () => runNext());
  await Promise.all(seeds);
}

// ─── Main Simulator Entry Point ───────────────────────────────────────────────
export async function runSimulator(config: Partial<SimulatorConfig> = {}): Promise<void> {
  const cfg = { ...DEFAULTS, ...config };
  completed = 0;
  failed    = 0;
  startTime.val = Date.now();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║         LLM-Orc-Station Simulator Starting           ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Users:       ${cfg.totalUsers}`);
  console.log(`  Queries/user:~${cfg.queriesPerUser}`);
  console.log(`  Concurrency: ${cfg.concurrency}`);
  console.log(`  Policy:      ${cfg.policy}`);
  console.log("─────────────────────────────────────────────────────\n");

  const totalQueries = cfg.totalUsers * cfg.queriesPerUser;

  // Build all user tasks
  const tasks = Array.from({ length: cfg.totalUsers }, (_, i) => {
    const userId  = `user-${String(i + 1).padStart(4, "0")}`;
    const persona = PERSONAS[i % PERSONAS.length]!;
    return () => simulateUser(userId, persona, cfg.queriesPerUser, cfg.policy, totalQueries);
  });

  // If durationMs is set, stagger releases; otherwise run flat pool
  if (cfg.durationMs) {
    const batchSize   = Math.ceil(cfg.totalUsers / (cfg.durationMs / 1000));
    const releaseInterval = 1000; // release a batch every second
    let released = 0;

    const interval = setInterval(() => {
      const batch = tasks.splice(0, batchSize);
      released += batch.length;
      runPool(batch, cfg.concurrency).catch(() => {});
      if (tasks.length === 0) clearInterval(interval);
    }, releaseInterval);

    // Wait for duration + extra buffer
    await sleep(cfg.durationMs + 10_000);
  } else {
    await runPool(tasks, cfg.concurrency);
  }

  // ── Final report ─────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime.val) / 1000).toFixed(1);
  const stats   = getStats();

  console.log("\n\n╔══════════════════════════════════════════════════════╗");
  console.log("║                  SIMULATION COMPLETE                 ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Duration:        ${elapsed}s`);
  console.log(`  Total Requests:  ${stats.totalRequests}`);
  console.log(`  Total Errors:    ${stats.totalErrors} (${stats.errorRate})`);
  console.log(`  Avg Latency:     ${stats.avgLatencyMs}ms`);
  console.log(`  P95 Latency:     ${stats.p95LatencyMs}ms`);
  console.log("\n  Model Distribution:");

  for (const [model, m] of Object.entries(stats.perModel)) {
    const bar = "▓".repeat(Math.round((m.requests / stats.totalRequests) * 30));
    console.log(`    ${model.padEnd(18)} ${bar} ${m.requests} reqs  err:${m.errorRate}  avg:${m.avgLatencyMs}ms`);
  }

  console.log("\n  Key Usage:");
  for (const [keyId, count] of Object.entries(stats.keyUsage).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${keyId.slice(0, 16)}…  ${count} uses`);
  }

  console.log("\n  Recent Rotation Events:");
  for (const evt of stats.rotationEvents.slice(-5)) {
    const ts = new Date(evt.ts).toISOString();
    console.log(`    [${ts}] ${evt.modelName}: +${evt.newKeyId?.slice(0,8)} deprecated:${evt.deprecatedKeyId?.slice(0,8) ?? "-"}`);
  }

  console.log("─────────────────────────────────────────────────────\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}