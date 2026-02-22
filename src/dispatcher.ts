import { sleep } from "bun";
import type { Model, ApiKey, Prompt } from "./types";

interface mockResponse {
    text: string;
}

export async function callModel(model: Model, key: ApiKey, prompt: Prompt): Promise<mockResponse> {
    
    await sleep(model.avgLatency)
    return {text: "mock response"}

}