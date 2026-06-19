/**
 * sprint/artifact_store — Shared Artifact Store for Sprint Pipeline
 *
 * Phase 2: Structured Sprint Workflow (gstack-inspired)
 *
 * Stores and retrieves artifacts produced during each sprint stage.
 * Artifacts persist across stages so downstream stages can consume
 * the outputs of upstream stages (e.g., Plan → Build uses the design doc).
 *
 * Artifact types:
 *   - design_doc    — Architecture design document
 *   - test_plan     — Test plan and scenarios
 *   - review_report — Code review findings
 *   - qa_report     — QA test results
 *   - security_report — Security audit findings
 *   - release_notes — Release notes for shipping
 *   - retro_notes   — Retrospective notes
 *
 * @module sprint/artifact_store
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const ARTIFACTS_DIR = path.resolve(__dirname, ".artifacts");

/** Maximum age for artifacts before auto-cleanup (7 days) */
const MAX_ARTIFACT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// Artifact Store
// ═══════════════════════════════════════════════════════════════════════════════

export class ArtifactStore {
  /**
   * @param {object} [options]
   * @param {string} [options.storeDir] - Custom directory for artifacts
   * @param {string} [options.sprintId] - Sprint identifier (auto-generated if not provided)
   */
  constructor(options = {}) {
    this._storeDir = options.storeDir || ARTIFACTS_DIR;
    this._sprintId = options.sprintId || `sprint-${Date.now()}`;
    this._artifacts = new Map();
    this._initialized = false;
  }

  /**
   * Initializes the store directory.
   * Must be called before any read/write operations.
   */
  async init() {
    if (this._initialized) return;

    if (!fs.existsSync(this._storeDir)) {
      fs.mkdirSync(this._storeDir, { recursive: true });
    }

    // Load existing artifacts from disk
    await this._loadFromDisk();

    this._initialized = true;
  }

  /**
   * Returns the current sprint ID.
   * @returns {string}
   */
  get sprintId() {
    return this._sprintId;
  }

  // ─── CRUD Operations ─────────────────────────────────────────────────────

  /**
   * Stores an artifact.
   *
   * @param {string} type - Artifact type (e.g., "design_doc", "test_plan")
   * @param {object|string} data - Artifact content
   * @param {object} [options]
   * @param {string} [options.stage] - Sprint stage that produced this
   * @param {string} [options.description] - Human-readable description
   * @returns {Promise<{ id: string, type: string, stage: string|null, timestamp: number }>}
   */
  async set(type, data, options = {}) {
    if (!this._initialized) await this.init();

    const id = `${type}-${Date.now()}`;
    const artifact = {
      id,
      type,
      stage: options.stage || null,
      description: options.description || null,
      data: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      timestamp: Date.now(),
      sprintId: this._sprintId,
    };

    this._artifacts.set(id, artifact);

    // Persist to disk
    await this._persist(id, artifact);

    return { id, type, stage: artifact.stage, timestamp: artifact.timestamp };
  }

  /**
   * Retrieves an artifact by ID.
   * @param {string} id - Artifact ID
   * @returns {object|null}
   */
  get(id) {
    return this._artifacts.get(id) || null;
  }

  /**
   * Finds artifacts by type, optionally filtered by stage.
   * Returns most recent first.
   *
   * @param {string} type - Artifact type to find
   * @param {object} [options]
   * @param {string} [options.stage] - Filter by stage
   * @param {number} [options.limit] - Max results
   * @returns {object[]}
   */
  findByType(type, options = {}) {
    const { stage, limit } = options;
    let results = [];

    for (const artifact of this._artifacts.values()) {
      if (artifact.type !== type) continue;
      if (stage && artifact.stage !== stage) continue;
      results.push(artifact);
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Gets the latest artifact of a given type.
   * @param {string} type - Artifact type
   * @param {object} [options]
   * @param {string} [options.stage] - Filter by stage
   * @returns {object|null}
   */
  getLatest(type, options = {}) {
    const results = this.findByType(type, { ...options, limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Lists all artifact types currently in the store.
   * @returns {string[]}
   */
  listTypes() {
    const types = new Set();
    for (const artifact of this._artifacts.values()) {
      types.add(artifact.type);
    }
    return Array.from(types).sort();
  }

  /**
   * Returns a summary of all artifacts.
   * @returns {Array<{ id: string, type: string, stage: string|null, description: string|null, timestamp: number }>}
   */
  summary() {
    const items = [];
    for (const artifact of this._artifacts.values()) {
      items.push({
        id: artifact.id,
        type: artifact.type,
        stage: artifact.stage,
        description: artifact.description,
        timestamp: artifact.timestamp,
      });
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  }

  /**
   * Deletes an artifact by ID.
   * @param {string} id - Artifact ID
   * @returns {boolean}
   */
  async delete(id) {
    const existed = this._artifacts.delete(id);
    if (existed) {
      const filePath = path.resolve(this._storeDir, `${id}.json`);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    return existed;
  }

  /**
   * Clears all artifacts for the current sprint.
   */
  async clear() {
    this._artifacts.clear();
    if (fs.existsSync(this._storeDir)) {
      const files = fs.readdirSync(this._storeDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            fs.unlinkSync(path.resolve(this._storeDir, file));
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  /**
   * Persists an artifact to disk as JSON.
   * @param {string} id
   * @param {object} artifact
   */
  async _persist(id, artifact) {
    const filePath = path.resolve(this._storeDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");
  }

  /**
   * Loads all artifacts from disk.
   */
  async _loadFromDisk() {
    if (!fs.existsSync(this._storeDir)) return;

    const files = fs.readdirSync(this._storeDir);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const filePath = path.resolve(this._storeDir, file);

      try {
        // Auto-cleanup old artifacts
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > MAX_ARTIFACT_AGE_MS) {
          fs.unlinkSync(filePath);
          continue;
        }

        const content = fs.readFileSync(filePath, "utf-8");
        const artifact = JSON.parse(content);
        if (artifact && artifact.id && artifact.type) {
          this._artifacts.set(artifact.id, artifact);
        }
      } catch {
        // Skip corrupted files
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export default ArtifactStore;
