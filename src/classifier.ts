// * Determines the complexity of a student's prompt so the router can
//  * pick the cheapest model that can still handle it.
//  *
//  * Why this matters:
//  *   mock  (free)      → "what is 2+2?"
//  *   flash ($0.075/1M) → "explain photosynthesis"
//  *   pro   ($3.50/1M)  → "write a detailed essay comparing mitosis and meiosis"
//  *
//  * Heuristics (in priority order):
//  *   1. Word count       – more words = more context needed = harder
//  *   2. Question markers – multi-part questions ("and", "also", "additionally")
//  *   3. Task verbs       – "explain", "compare", "analyse" → higher grade
//  *   4. Code keywords    – "code", "function", "algorithm" → medium at minimum
//  *   5. Trivial patterns – pure arithmetic, yes/no, definition lookup → simple

import type { Complexity } from "./types";

const COMPLEX_VERBS = [
    "analyse", "analyze", "compare", "contrast", "evaluate", "critique",
    "discuss", "argue", "justify", "synthesise", "synthesize", "design",
    "derive", "prove", "essay", "debate", "assess"
];
  
const MEDIUM_VERBS = [
    "explain", "describe", "summarise", "summarize", "list", "outline",
    "define", "identify", "illustrate", "show", "calculate", "solve",
    "write", "create", "make", "help me understand"
];
  
const CODE_KEYWORDS = [
    "code", "function", "program", "algorithm", "implement", "debug",
    "class", "loop", "recursion", "compile", "script"
];

const TRIVIAL_MATH = /^[\s\d+\-*/^()=?.what is]+$/i;

export function classifyPrompt(prompt: string): Complexity {
    const lower = prompt.toLowerCase().trim();
    const wordCount = lower.split(/\s+/).length;

    if (wordCount <= 8 && TRIVIAL_MATH.test(lower)) return "simple";
    
    if (wordCount > 120) return "complex";

    if (COMPLEX_VERBS.some(v => lower.includes(v))) return "complex";
  
    const questionCount = (lower.match(/\?/g) || []).length;
    if (questionCount >= 2) return "complex";
  
    if (wordCount > 40) return "medium";
    if (MEDIUM_VERBS.some(v => lower.includes(v))) return "medium";
    if (CODE_KEYWORDS.some(k => lower.includes(k))) return "medium";
 
    return "simple";
  }
  
export function explainClassification(prompt: string): string {
    const c = classifyPrompt(prompt);
    const wordCount = prompt.split(/\s+/).length;
    return `[${c.toUpperCase()}] words=${wordCount} prompt="${prompt.slice(0, 60)}…"`;
  }
