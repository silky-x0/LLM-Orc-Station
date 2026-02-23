// key lifecycle
// active -> deprecated -> revoked

export type keyStatus = "active" | "deprecated" | "revoked"

// Circuit breaker state
//closed - normal operation
//open - too many recent failure, key is slipped
//half - testing if key is recovered

export type BreakerState = "closed" | "open" | "half"

export interface ApiKey {
    id: string;
    value: string;
    createdAt: number;
    lastUsed: number;
    usage: number;
    status: keyStatus;
    breakerState: BreakerState;
    consecutiveFails: number;
    breakerOpenedAt: number;
}

export interface Model {
    name: string;
    apiModel: string;
    costPer1kTokens: number;
    avgLatency: number;
    rpm: number;
    keys: ApiKey[];
    isMock: boolean;  // if true dispatcher skips http calls
}

export type Complexity = "simple" | "medium" | "complex"

export type Policy = "cost" | "latency" | "fallback"

export interface LogEntry{
    ts: number;
    userId: string;
    persona: string;
    prompt: string;
    complexity: Complexity;
    model: string;
    keyId: string;
    latencyMs: number;
    ok: boolean;
    errorMsg?: string;
}

export interface QueryRequest {
    userId: string;
    persona: string;
    prompt: string;
    policy?: Policy;
}

export interface QueryResponse {
    model: string;
    keyId: string;
    latencyMs: number;
    complexity: Complexity;
    response: string;
    ok: boolean;
}

export interface RotationEvent {
    ts: number;
    modelName: string;
    newKeyId: string;
    deprecatedKeyId?: string;
    revokedKeyId?: string;
}
