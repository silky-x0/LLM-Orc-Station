# LLM-Orc-Station
Multi-provider LLM orchestrator with smart routing policies, automatic key rotation, and 1K-user load simulation.

## Architecture

Client -> API -> Router -> Key Manager -> Providers

## Routing Policy

Scoring based on cost, latency, health, quota.

## Key Rotation

Background job with dual-key overlap.

## Failure Handling

Circuit breaker + fallback.

## Scaling

Shared state in Redis.[not as of now]