# Core — Analysis Engine

## Purpose
Provides the base infrastructure for running analysis layers in **Request Mode** (LAYERS pattern).

## Components

### BaseLayer
Abstract base class. Every analysis layer extends this and implements `process(snapshot, context) → delta`.

### AnalysisEngine
Orchestrates the analysis pipeline:
1. Iterates through registered layers in order
2. For each layer: snapshot → process → merge delta
3. Returns the complete analysis report

## State Owned
- `meta.*` — report metadata (timestamps, duration, layers executed)

## State Read
None (this is the engine, not a layer)

## Contract
- Layers are executed **sequentially** in registration order
- Each layer receives an **immutable snapshot** — mutations throw errors
- Each layer returns a **delta** (plain object) that is merged into state
- Keys prefixed with `_` are **internal** and stripped from the final report
- If a layer fails, the error is logged and the next layer continues
- The engine never modifies layer results — deltas are merged as-is

## Delta Format
```json
{
  "meta": {
    "projectId": 1,
    "projectName": "My Project",
    "analyzedAt": "2026-02-15T12:00:00Z",
    "version": "1.0.0",
    "durationMs": 1234,
    "layersExecuted": [
      { "name": "file-system", "durationMs": 200, "status": "completed" }
    ]
  }
}
```
