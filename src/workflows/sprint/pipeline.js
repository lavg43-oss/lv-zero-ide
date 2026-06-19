/**
 * sprint/pipeline — Structured Sprint Pipeline Orchestrator
 *
 * Phase 2: Structured Sprint Workflow (gstack-inspired)
 *
 * Orchestrates a connected sprint cycle:
 *   Think → Plan → Build → Review → Test → Ship → Reflect
 *
 * Each stage produces artifacts consumed by downstream stages.
 * The pipeline maintains state for crash recovery and progress tracking.
 *
 * gstack inspiration:
 *   Think  = /office-hours (YC forcing questions)
 *   Plan   = /plan-ceo-review + /plan-eng-review
 *   Build  = implementation phase
 *   Review = /review (staff engineer code review)
 *   Test   = /qa (automated QA)
 *   Ship   = /ship (release engineering)
 *   Reflect = /retro (team-aware retrospective)
 *
 * @module sprint/pipeline
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import ArtifactStore from "./artifact_store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Ordered sprint stages */
const SPRINT_STAGES = [
  "think",
  "plan",
  "build",
  "review",
  "test",
  "ship",
  "reflect",
];

/** Human-readable stage names */
const STAGE_NAMES = {
  think: "💡 Think — Problem Framing",
  plan: "📋 Plan — Architecture & Design",
  build: "🔨 Build — Implementation",
  review: "👁️ Review — Code Review",
  test: "🧪 Test — QA & Verification",
  ship: "🚀 Ship — Release Engineering",
  reflect: "🔍 Reflect — Retrospective",
};

/** Stage descriptions for context injection */
const STAGE_DESCRIPTIONS = {
  think: "Six forcing questions that reframe the problem. Challenge premises, generate alternatives, find the 10x opportunity.",
  plan: "Lock architecture, data flow, diagrams, edge cases, and test strategy before writing code.",
  build: "Implement the planned solution following project conventions. Write tests alongside code.",
  review: "Staff-engineer-level code review. Find bugs that pass CI but blow up in production. Auto-fix obvious ones.",
  test: "Automated QA: run tests, verify flows, capture screenshots, generate regression tests for fixes.",
  ship: "Sync main, run full test suite, audit coverage, update changelog, push, open PR.",
  reflect: "Team-aware retrospective: what went well, what to improve, action items for next sprint.",
};

/** Path to stage prompt markdown files */
const STAGES_DIR = path.resolve(__dirname, "stages");

/** Path to pipeline state file (for crash recovery) */
const STATE_FILE = path.resolve(__dirname, ".pipeline-state.json");

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

export class SprintPipeline extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.sprintId] - Custom sprint ID
   * @param {string} [options.projectPath] - Project path for artifact storage
   * @param {object} [options.logger] - Logger instance (console-like)
   */
  constructor(options = {}) {
    super();

    this._sprintId = options.sprintId || `sprint-${Date.now()}`;
    this._projectPath = options.projectPath || process.cwd();
    this._logger = options.logger || console;

    /** @type {"idle"|"running"|"paused"|"completed"|"aborted"} */
    this._state = "idle";

    /** Current stage index in SPRINT_STAGES */
    this._currentStageIndex = -1;

    /** @type {string|null} Current stage slug */
    this._currentStage = null;

    /** @type {ArtifactStore} Shared artifact store */
    this._store = new ArtifactStore({
      sprintId: this._sprintId,
      storeDir: path.resolve(this._projectPath, ".sprint-artifacts"),
    });

    /** @type {Array<{ stage: string, status: string, timestamp: number, error?: string }>} */
    this._stageHistory = [];

    /** @type {object|null} Saved pipeline state for crash recovery */
    this._savedState = null;

    /** @type {boolean} Whether the pipeline was restored from saved state */
    this._restored = false;
  }

  // ─── Properties ─────────────────────────────────────────────────────────

  /** @returns {string} Current sprint ID */
  get sprintId() {
    return this._sprintId;
  }

  /** @returns {string} Current pipeline state */
  get state() {
    return this._state;
  }

  /** @returns {string|null} Current stage slug */
  get currentStage() {
    return this._currentStage;
  }

  /** @returns {number} Current stage index (0-based) */
  get currentStageIndex() {
    return this._currentStageIndex;
  }

  /** @returns {number} Total stages (7) */
  get totalStages() {
    return SPRINT_STAGES.length;
  }

  /** @returns {Array} Stage history log */
  get stageHistory() {
    return [...this._stageHistory];
  }

  /** @returns {ArtifactStore} The artifact store */
  get store() {
    return this._store;
  }

  /** @returns {boolean} Whether this pipeline was restored from saved state */
  get restored() {
    return this._restored;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initializes the pipeline: loads artifact store and checks for saved state.
   */
  async init() {
    await this._store.init();

    // Check for saved pipeline state (crash recovery)
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        this._savedState = JSON.parse(raw);
        this._logger.info(`   🔄 Sprint pipeline: estado guardado encontrado (etapa: ${this._savedState.currentStage || "ninguna"})`);
      } catch {
        this._savedState = null;
      }
    }

    this.emit("initialized", { sprintId: this._sprintId });
  }

  /**
   * Starts the sprint pipeline from the beginning.
   * @param {object} [context] - Initial context (task description, goals)
   * @returns {Promise<{ success: boolean, stage: string, instructions: string }>}
   */
  async start(context = {}) {
    if (this._state === "running") {
      return { success: false, error: "Pipeline already running" };
    }

    this._state = "running";
    this._currentStageIndex = 0;
    this._currentStage = SPRINT_STAGES[0];
    this._stageHistory = [];

    // Store initial context as an artifact
    if (context.task) {
      await this._store.set("task_description", context.task, {
        stage: "think",
        description: "Original task description",
      });
    }

    // Save state for crash recovery
    await this._saveState();

    this.emit("pipeline:start", {
      sprintId: this._sprintId,
      stage: this._currentStage,
      stageIndex: this._currentStageIndex,
      totalStages: this.totalStages,
      context,
    });

    this._logger.info(`   🏁 Sprint iniciado: ${this._sprintId}`);
    this._logger.info(`   📍 Etapa 1/${this.totalStages}: ${STAGE_NAMES[this._currentStage]}`);

    return {
      success: true,
      stage: this._currentStage,
      stageName: STAGE_NAMES[this._currentStage],
      instructions: await this._getStageInstructions(this._currentStage, context),
      stageIndex: this._currentStageIndex,
      totalStages: this.totalStages,
    };
  }

  /**
   * Advances to the next sprint stage.
   * @param {object} [stageResult] - Result from the current stage (artifacts, decisions)
   * @returns {Promise<{ success: boolean, stage: string|null, instructions: string|null, completed: boolean }>}
   */
  async next(stageResult = {}) {
    if (this._state !== "running") {
      return { success: false, error: "Pipeline not running" };
    }

    // Record current stage completion
    const currentStage = this._currentStage;
    this._stageHistory.push({
      stage: currentStage,
      status: stageResult.error ? "failed" : "completed",
      timestamp: Date.now(),
      error: stageResult.error || undefined,
    });

    this.emit("stage:complete", {
      stage: currentStage,
      stageIndex: this._currentStageIndex,
      result: stageResult,
    });

    // Store artifacts from this stage
    if (stageResult.artifacts) {
      for (const [type, data] of Object.entries(stageResult.artifacts)) {
        await this._store.set(type, data, {
          stage: currentStage,
          description: stageResult.descriptions?.[type] || `Artifact from ${currentStage}`,
        });
      }
    }

    // Check if this was the last stage
    if (this._currentStageIndex >= SPRINT_STAGES.length - 1) {
      this._state = "completed";
      await this._clearState();

      this.emit("pipeline:complete", {
        sprintId: this._sprintId,
        stages: this._stageHistory,
        artifacts: this._store.summary(),
      });

      this._logger.info(`   ✅ Sprint completado: ${this._sprintId}`);
      this._logger.info(`   📊 ${this._stageHistory.length} etapas completadas`);

      return {
        success: true,
        stage: null,
        instructions: null,
        completed: true,
      };
    }

    // Advance to next stage
    this._currentStageIndex++;
    this._currentStage = SPRINT_STAGES[this._currentStageIndex];

    // Build context from previous stage artifacts
    const context = this._buildStageContext();

    // Save state for crash recovery
    await this._saveState();

    this.emit("stage:start", {
      stage: this._currentStage,
      stageIndex: this._currentStageIndex,
      totalStages: this.totalStages,
      context,
    });

    this._logger.info(`   📍 Etapa ${this._currentStageIndex + 1}/${this.totalStages}: ${STAGE_NAMES[this._currentStage]}`);

    return {
      success: true,
      stage: this._currentStage,
      stageName: STAGE_NAMES[this._currentStage],
      instructions: await this._getStageInstructions(this._currentStage, context),
      stageIndex: this._currentStageIndex,
      totalStages: this.totalStages,
      completed: false,
    };
  }

  /**
   * Pauses the pipeline (saves state for later resume).
   */
  async pause() {
    if (this._state !== "running") {
      return { success: false, error: "Pipeline not running" };
    }

    this._state = "paused";
    await this._saveState();

    this.emit("pipeline:pause", {
      sprintId: this._sprintId,
      stage: this._currentStage,
      stageIndex: this._currentStageIndex,
    });

    this._logger.info(`   ⏸️ Sprint pausado en etapa: ${this._currentStage}`);

    return { success: true, stage: this._currentStage };
  }

  /**
   * Resumes a paused or saved pipeline.
   * @returns {Promise<{ success: boolean, stage: string|null, instructions: string|null }>}
   */
  async resume() {
    if (this._state === "running") {
      return { success: false, error: "Pipeline already running" };
    }

    // Load saved state if available
    if (this._savedState) {
      this._currentStageIndex = this._savedState.currentStageIndex;
      this._currentStage = this._savedState.currentStage;
      this._stageHistory = this._savedState.stageHistory || [];
      this._restored = true;
    }

    if (!this._currentStage) {
      return { success: false, error: "No saved pipeline state to resume" };
    }

    this._state = "running";

    const context = this._buildStageContext();

    this.emit("pipeline:resume", {
      sprintId: this._sprintId,
      stage: this._currentStage,
      stageIndex: this._currentStageIndex,
      restored: this._restored,
    });

    this._logger.info(`   ▶️ Sprint reanudado en etapa: ${STAGE_NAMES[this._currentStage]}${this._restored ? " (recuperado)" : ""}`);

    return {
      success: true,
      stage: this._currentStage,
      stageName: STAGE_NAMES[this._currentStage],
      instructions: await this._getStageInstructions(this._currentStage, context),
      stageIndex: this._currentStageIndex,
      totalStages: this.totalStages,
    };
  }

  /**
   * Aborts the pipeline.
   */
  async abort(reason = "User requested abort") {
    this._state = "aborted";
    await this._clearState();

    this.emit("pipeline:abort", {
      sprintId: this._sprintId,
      reason,
      stagesCompleted: this._stageHistory.length,
    });

    this._logger.info(`   🛑 Sprint abortado: ${reason}`);

    return { success: true, stagesCompleted: this._stageHistory.length };
  }

  /**
   * Returns the current pipeline status.
   * @returns {object}
   */
  getStatus() {
    return {
      sprintId: this._sprintId,
      state: this._state,
      currentStage: this._currentStage,
      currentStageName: this._currentStage ? STAGE_NAMES[this._currentStage] : null,
      stageIndex: this._currentStageIndex,
      totalStages: this.totalStages,
      stagesCompleted: this._stageHistory.length,
      stageHistory: this._stageHistory,
      artifacts: this._store.summary(),
      restored: this._restored,
    };
  }

  // ─── Stage Instructions ────────────────────────────────────────────────

  /**
   * Gets the instructions for a given stage.
   * Reads from the stage's markdown file, injects context from artifacts.
   *
   * @param {string} stage - Stage slug
   * @param {object} context - Context from previous stages
   * @returns {Promise<string>}
   */
  async _getStageInstructions(stage, context = {}) {
    const stageFile = path.resolve(STAGES_DIR, `${stage}.md`);

    let instructions = "";

    // Try to load from markdown file
    if (fs.existsSync(stageFile)) {
      instructions = fs.readFileSync(stageFile, "utf-8");
    } else {
      // Fallback: generate basic instructions
      instructions = this._generateFallbackInstructions(stage);
    }

    // Inject context from previous stages
    const contextBlock = this._buildContextBlock(context);
    if (contextBlock) {
      instructions += `\n\n---\n## Context from Previous Stages\n\n${contextBlock}\n`;
    }

    // Inject artifact references
    const artifactSummary = this._store.summary();
    if (artifactSummary.length > 0) {
      instructions += `\n\n---\n## Available Artifacts\n\n`;
      for (const art of artifactSummary) {
        instructions += `- **${art.type}** (${art.stage || "unknown"}): ${art.description || "No description"}\n`;
      }
    }

    return instructions;
  }

  /**
   * Generates fallback instructions for a stage when no markdown file exists.
   * @param {string} stage
   * @returns {string}
   */
  _generateFallbackInstructions(stage) {
    const name = STAGE_NAMES[stage] || stage;
    const desc = STAGE_DESCRIPTIONS[stage] || "Complete this sprint stage.";

    return `# ${name}\n\n${desc}\n\n## Objective\n\nComplete the ${stage} stage of the sprint cycle.\n\n## Actions\n\n1. Review context from previous stages\n2. Execute the ${stage} activities\n3. Produce artifacts for the next stage\n4. Report results\n`;
  }

  /**
   * Builds context object from artifacts of previous stages.
   * @returns {object}
   */
  _buildStageContext() {
    const context = {};

    // Gather the latest artifact of each type
    const types = this._store.listTypes();
    for (const type of types) {
      const latest = this._store.getLatest(type);
      if (latest) {
        context[type] = latest.data;
      }
    }

    return context;
  }

  /**
   * Builds a markdown context block from the context object.
   * @param {object} context
   * @returns {string}
   */
  _buildContextBlock(context) {
    if (!context || Object.keys(context).length === 0) return "";

    const blocks = [];
    for (const [key, value] of Object.entries(context)) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const content = typeof value === "string" ? value.substring(0, 2000) : JSON.stringify(value, null, 2).substring(0, 2000);
      blocks.push(`### ${label}\n\n${content}`);
    }

    return blocks.join("\n\n---\n\n");
  }

  // ─── State Persistence ─────────────────────────────────────────────────

  /**
   * Saves pipeline state for crash recovery.
   */
  async _saveState() {
    const state = {
      sprintId: this._sprintId,
      state: this._state,
      currentStageIndex: this._currentStageIndex,
      currentStage: this._currentStage,
      stageHistory: this._stageHistory,
      savedAt: Date.now(),
    };

    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      this._logger.warn(`   ⚠️ Sprint pipeline: error guardando estado: ${err.message}`);
    }
  }

  /**
   * Clears saved pipeline state.
   */
  async _clearState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
      }
    } catch {
      // Ignore
    }
    this._savedState = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export {
  SPRINT_STAGES,
  STAGE_NAMES,
  STAGE_DESCRIPTIONS,
};

export default SprintPipeline;
