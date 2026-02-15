/**
 * AnalysisEngine — runs analysis layers sequentially in Request Mode.
 *
 * LAYERS pattern flow:
 *   For each layer:
 *     1. Snapshot current state (deep clone, frozen)
 *     2. Call layer.process(snapshot, context)
 *     3. Merge returned delta into state
 *     4. Repeat for next layer
 *
 * The final state IS the complete analysis report.
 */
class AnalysisEngine {
  constructor() {
    this.layers = [];
  }

  /**
   * Register a layer. Order matters — layers run sequentially.
   */
  addLayer(layer) {
    this.layers.push(layer);
    return this;
  }

  /**
   * Run full analysis pipeline.
   * @param {Object} projectConfig - Project settings from database
   * @param {Function} onProgress  - Optional callback(info) for progress updates
   * @returns {Object} Complete analysis report
   */
  async analyze(projectConfig, onProgress) {
    const startTime = Date.now();

    let state = {
      meta: {
        projectId: projectConfig.id,
        projectName: projectConfig.name,
        analyzedAt: new Date().toISOString(),
        version: '1.0.0',
        layersExecuted: []
      }
    };

    const context = {
      project: projectConfig,
      startTime
    };

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const layerStart = Date.now();

      // Progress callback
      if (onProgress) {
        onProgress({
          layer: layer.name,
          step: i + 1,
          total: this.layers.length,
          status: 'running'
        });
      }

      try {
        // 1. Create immutable snapshot
        const snapshot = deepFreeze(deepClone(state));

        // 2. Layer processes and returns delta
        const delta = await layer.process(snapshot, context);

        // 3. Merge delta into state atomically
        if (delta && typeof delta === 'object') {
          state = deepMerge(state, delta);
        }

        // Track layer execution
        state.meta.layersExecuted.push({
          name: layer.name,
          durationMs: Date.now() - layerStart,
          status: 'completed'
        });

      } catch (err) {
        console.error(`[AnalysisEngine] Layer "${layer.name}" failed:`, err.message);

        state.meta.layersExecuted.push({
          name: layer.name,
          durationMs: Date.now() - layerStart,
          status: 'failed',
          error: err.message
        });

        // Continue with next layer — don't abort the whole analysis
      }
    }

    // Finalize report
    state.meta.durationMs = Date.now() - startTime;

    // Strip internal data (prefixed with _) before returning
    return stripInternal(state);
  }
}

// ─── Utility Functions ───

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Object.isFrozen(obj[key])) {
      deepFreeze(obj[key]);
    }
  }
  return obj;
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

function stripInternal(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripInternal);
  const cleaned = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue; // Strip internal keys
    cleaned[key] = stripInternal(obj[key]);
  }
  return cleaned;
}

module.exports = AnalysisEngine;
