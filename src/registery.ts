import { v4 as uuid } from "uuid";
import type { Model, ApiKey, LogEntry, Policy } from "./types";


export const models: Record<string, Model> = {
    flash : {
        name: "gemini-flash",
        cost: 0.1,
        avgLatency: 80,
        rpm: 100,
        keys: []
    },
    pro : {
        name: "gemini-pro",
        cost: 1.0,
        avgLatency: 200,
        rpm: 30,
        keys: []
    },   
    mock: {
        name: "mock",
        cost: 0.01,
        avgLatency: 30,
        rpm: 500,
        keys: []
    }
};

export function initKeys() {
    Object.values(models).forEach(m => {
        for (let i = 0; i < 2; i++){
            m.keys.push(makeKey())
        }
    })
}

function makeKey() : ApiKey {
    const value = "key-" + uuid().slice(0, 8)
    return {
        id: uuid(),
        value,
        createdAt: Date.now(),
        lastUsed: 0,
        usage: 0,
        status: "active"
    }
}
