import { models } from "./registery";
import type { Prompt, Policy } from "./types";

export function classifyRequest(prompt: string){
    if (prompt.length < 150) return "simple";
    if (prompt.includes("code")) return "medium";
    return "heavy";
}

export function selectModel(policy: Policy, requestType: string){
    const type = classifyRequest(requestType);

    let candidates = Object.values(models);

    candidates = candidates.filter( m =>
        m.keys.some(k => k.status !== "revoked")
    );

    const scored = candidates.map(m => ({
        model: m,
        score: scored(m, policy, type)
    }));

    //TODO fix return type and add fallback policy
}