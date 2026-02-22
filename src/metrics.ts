
interface metrics {
    total: number;
    errors: number;
    models: Record<string, number>;
    keys: Record<string, number>;
    latencies: number[];
}

export const metrics: metrics = {
    total: 0,
    errors: 0,
    models: {},
    keys: {},
    latencies: []
};

interface metricsResponse extends metrics {
    avgLatency: string;
    errorRate: number;
}

export function logRequest(model: string, key: string, latency: number, ok: boolean) {
    metrics.total++;

    if (!ok) metrics.errors++;

    metrics.models[model] = (metrics.models[model] || 0) + 1;

    metrics.keys[key] = (metrics.keys[key] || 0) + 1;

    metrics.latencies.push(latency);
}

export function getMetrics() : metricsResponse {
    const avg = 
        metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length || 1;

    return {
        ...metrics,
        avgLatency: avg.toFixed(2),
        errorRate: metrics.errors / metrics.total
    }
}