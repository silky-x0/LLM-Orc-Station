
export type keyStatus = "active" | "inactive" | "revoked"

export interface ApiKey {
    id: string;
    value: string;
    createdAt: number;
    lastUsed: number;
    usage: number;
    status: keyStatus
}

export interface Model {
    name: string;
    cost: number;
    avgLatency: number;
    rpm: number;
    keys: ApiKey[]
}

export type Policy = "cost" | "latency" | "fallback"

export interface LogEntry{
    ts: number;
    userId: string;
    model: string;
    key: string;
    latency: number;
    ok: boolean;
    
}