/**
 * BaseLayer — abstract base class for all analysis layers.
 *
 * LAYERS pattern (Request Mode):
 *   1. Engine takes an immutable snapshot of current state
 *   2. Layer receives snapshot + context (project config)
 *   3. Layer returns a delta (plain object with its results)
 *   4. Engine merges delta into state atomically
 *   5. Next layer sees the updated snapshot
 *
 * Each layer MUST:
 *   - Have a unique `name`
 *   - Implement `async process(snapshot, context)` → returns delta object
 *   - NEVER mutate the snapshot
 *   - Have a LAYER.md contract describing its inputs/outputs
 */
class BaseLayer {
  constructor(name) {
    if (!name) throw new Error('Layer must have a name');
    this.name = name;
  }

  /**
   * Process analysis for this layer.
   * @param {Object} snapshot - Immutable snapshot of accumulated state from previous layers
   * @param {Object} context  - Project config and shared utilities
   * @returns {Object} delta  - Plain object to merge into state
   */
  async process(snapshot, context) {
    throw new Error(`${this.name}: process() not implemented`);
  }
}

module.exports = BaseLayer;
