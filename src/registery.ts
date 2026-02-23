import { v4 as uuid } from "uuid";
import type { Model, ApiKey, RotationEvent } from "./types";


export const models: Record<string, Model> = {
    flash : {
        name: "gemini-flash",
        apiModel: "gemini-3.1-low",
        costPer1kTokens: 1.0,
        avgLatency: 80,
        rpm: 100,
        keys: [],
        isMock: false,
    },
    pro : {
        name: "gemini-pro",
        apiModel:"gemini-3.1-high",
        costPer1kTokens: 3.0,
        avgLatency: 200,
        rpm: 30,
        keys: [],
        isMock: false,
    },   
    mock: {
        name: "mock",
        apiModel: "Some-wierd-LLM",
        costPer1kTokens: 0.01,
        avgLatency: 30,
        rpm: 500,
        keys: [],
        isMock: true,
    }
};


export const rotationLog: RotationEvent[] = [];

function makeKey(fakeValue?: string): ApiKey {
    return {
      id: uuid(),
      value: fakeValue ?? `key-${uuid().slice(0, 8)}`,
      createdAt: Date.now(),
      lastUsed: 0,
      usage: 0,
      status: "active",
      consecutiveFails: 0,
      breakerState: "closed",
      breakerOpenedAt: 0,
    };
  }


export function initRegistry(): void {
    for (const model of Object.values(models)) {
        
        const envKey = process.env[`GEMINI_API_KEY`];
        if (!model.isMock && envKey) {
            model.keys.push(makeKey(envKey));
            model.keys.push(makeKey(envKey));
        } else {
            model.keys.push(makeKey());
            model.keys.push(makeKey());
        }
    }
}


export function getUsableKeys(model: Model): ApiKey[] {
    const now = Date.now();
    return model.keys.filter(k => {
      if (k.status === "revoked") return false;
  
      
      if (k.breakerState === "open") {
        if (now - k.breakerOpenedAt > 30_000) {
          k.breakerState = "half";
        } else {
          return false; 
        }
      }
      return true;
    });
  }
  

// round-robin

export function pickKey(model: Model): ApiKey | null {
    const usable = getUsableKeys(model);
    if (usable.length === 0) return null;
  
    
    usable.sort((a, b) => a.usage - b.usage);
    return usable[0] ?? null;
}
  
  
export function addKey(modelName: string, value?: string): ApiKey {
    const model = models[modelName];
    if (!model) throw new Error(`Unknown model: ${modelName}`);
    const key = makeKey(value);
    model.keys.push(key);
    return key;
  }