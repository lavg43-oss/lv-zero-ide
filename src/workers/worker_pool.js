/**
 * ─── Worker Pool for lv-zero ─────────────────────────────────────────────
 *
 * Manages a pool of background worker processes (child_process forks).
 * Each worker runs a sub-agent task independently and reports results.
 *
 * Features:
 *   - Max N concurrent workers (configurable)
 *   - Task queue for pending tasks
 *   - Automatic worker recycling
 *   - Timeout per worker (configurable)
 *   - Progress reporting from workers
 *   - Dependency tracking (some tasks wait for others)
 *
 * v1.0 — June 2026
 *
 * @module worker_pool
 */

import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default maximum concurrent workers */
const DEFAULT_MAX_WORKERS = 3;

/** Default worker timeout in ms (5 minutes) */
const DEFAULT_WORKER_TIMEOUT = 5 * 60 * 1000;

/** Default progress interval for status updates from workers (ms) */
const DEFAULT_PROGRESS_INTERVAL = 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// Worker Pool
// ═══════════════════════════════════════════════════════════════════════════════

export class WorkerPool extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxWorkers=3] - Max concurrent workers
   * @param {number} [options.workerTimeout=300000] - Worker timeout in ms
   * @param {object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    super();
    this._maxWorkers = options.maxWorkers || DEFAULT_MAX_WORKERS;
    this._workerTimeout = options.workerTimeout || DEFAULT_WORKER_TIMEOUT;
    this._logger = options.logger || console;

    /** @type {Map<string, object>} Active workers: id → { process, task, startTime } */
    this._activeWorkers = new Map();

    /** @type {Array} Pending task queue */
    this._queue = [];

    /** @type {Array} Completed tasks */
    this._completed = [];

    /** @type {number} Total tasks created */
    this._totalCreated = 0;

    /** @type {number} Worker ID counter */
    this._workerIdCounter = 0;

    /** @type {string} Path to the worker script */
    this._workerScript = path.resolve(__dirname, "worker.js");
  }

  // ─── Properties ────────────────────────────────────────────────────────

  /** @returns {number} Number of active workers */
  get activeCount() {
    return this._activeWorkers.size;
  }

  /** @returns {number} Number of queued tasks */
  get queuedCount() {
    return this._queue.length;
  }

  /** @returns {number} Number of completed tasks */
  get completedCount() {
    return this._completed.length;
  }

  /** @returns {number} Total tasks created */
  get totalCreated() {
    return this._totalCreated;
  }

  /** @returns {boolean} Whether the pool has capacity for more workers */
  get hasCapacity() {
    return this._activeWorkers.size < this._maxWorkers;
  }

  /** @returns {object} Full status of the pool */
  get status() {
    return {
      active: this.activeCount,
      queued: this.queuedCount,
      completed: this.completedCount,
      totalCreated: this.totalCreated,
      maxWorkers: this._maxWorkers,
      hasCapacity: this.hasCapacity,
      workers: Array.from(this._activeWorkers.entries()).map(([id, w]) => ({
        id,
        taskId: w.task?.id || null,
        taskName: w.task?.name || "unknown",
        elapsed: Date.now() - w.startTime,
        progress: w.task?.progress || 0,
        status: w.task?.status || "running",
      })),
      queue: this._queue.map((t) => ({
        id: t.id,
        name: t.name,
        dependsOn: t.dependsOn || [],
      })),
    };
  }

  // ─── Task Management ───────────────────────────────────────────────────

  /**
   * Adds a task to the pool. Runs immediately if capacity available,
   * otherwise queues it.
   *
   * @param {object} task - Task definition
   * @param {string} task.name - Human-readable task name
   * @param {string} task.description - Task description
   * @param {string} task.instruction - Instruction for the sub-agent
   * @param {string[]} [task.skills] - Skills the task needs
   * @param {string[]} [task.dependsOn] - Task IDs this task depends on
   * @param {number} [task.timeout] - Custom timeout in ms
   * @returns {string} Task ID
   */
  addTask(task) {
    const taskId = `task-${++this._workerIdCounter}-${Date.now()}`;
    const taskEntry = {
      id: taskId,
      name: task.name || `Task ${this._workerIdCounter}`,
      description: task.description || "",
      instruction: task.instruction || "",
      skills: task.skills || [],
      dependsOn: task.dependsOn || [],
      timeout: task.timeout || this._workerTimeout,
      progress: 0,
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };

    // Check if dependencies are met
    const depsMet = taskEntry.dependsOn.every((depId) =>
      this._completed.some((c) => c.id === depId)
    );

    if (depsMet && this.hasCapacity) {
      this._startWorker(taskEntry);
    } else {
      this._queue.push(taskEntry);
      this._logger.info(`   📋 Worker: "${taskEntry.name}" encolado (${this.queuedCount} pendientes)`);
    }

    this._totalCreated++;
    this.emit("task:queued", { taskId: taskEntry.id, name: taskEntry.name });
    return taskEntry.id;
  }

  /**
   * Gets the result of a completed task.
   *
   * @param {string} taskId
   * @returns {object|null}
   */
  getResult(taskId) {
    return this._completed.find((t) => t.id === taskId) || null;
  }

  /**
   * Cancels a task (active or queued).
   *
   * @param {string} taskId
   * @returns {boolean}
   */
  cancelTask(taskId) {
    // Check active workers
    for (const [workerId, worker] of this._activeWorkers) {
      if (worker.task?.id === taskId) {
        try {
          worker.process.kill("SIGTERM");
        } catch {}
        this._activeWorkers.delete(workerId);
        this.emit("task:cancelled", { taskId });
        this._processQueue();
        return true;
      }
    }

    // Check queue
    const idx = this._queue.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      this._queue.splice(idx, 1);
      this.emit("task:cancelled", { taskId });
      return true;
    }

    return false;
  }

  /**
   * Cancels all tasks and shuts down the pool.
   */
  async shutdown() {
    this._logger.info("   ⏹ Deteniendo Worker Pool...");

    // Kill all active workers
    for (const [workerId, worker] of this._activeWorkers) {
      try {
        worker.process.kill("SIGKILL");
      } catch {}
    }
    this._activeWorkers.clear();

    // Clear queue
    this._queue = [];

    this.emit("pool:shutdown", {
      completed: this._completed.length,
      cancelled: this._totalCreated - this._completed.length,
    });

    this._logger.info(`   ✅ Worker Pool detenido (${this._completed.length} tareas completadas)`);
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  /**
   * Starts a worker for a task.
   * @param {object} taskEntry
   */
  _startWorker(taskEntry) {
    const workerId = `worker-${this._workerIdCounter}`;
    taskEntry.status = "running";
    taskEntry.startedAt = Date.now();

    try {
      const workerProcess = fork(this._workerScript, [], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
          WORKER_TASK_ID: taskEntry.id,
          WORKER_TASK_NAME: taskEntry.name,
          WORKER_INSTRUCTION: taskEntry.instruction,
          WORKER_SKILLS: JSON.stringify(taskEntry.skills),
          WORKER_TIMEOUT: String(taskEntry.timeout),
        },
      });

      const workerEntry = {
        process: workerProcess,
        task: taskEntry,
        startTime: Date.now(),
      };

      this._activeWorkers.set(workerId, workerEntry);

      // ── Handle messages from worker ──
      workerProcess.on("message", (msg) => {
        switch (msg.type) {
          case "progress":
            taskEntry.progress = msg.progress;
            this.emit("task:progress", {
              taskId: taskEntry.id,
              name: taskEntry.name,
              progress: msg.progress,
              status: msg.status || "running",
              detail: msg.detail || "",
            });
            break;

          case "complete":
            taskEntry.status = "completed";
            taskEntry.completedAt = Date.now();
            taskEntry.result = msg.result;
            this._completed.push(taskEntry);
            this._activeWorkers.delete(workerId);
            this.emit("task:complete", {
              taskId: taskEntry.id,
              name: taskEntry.name,
              result: msg.result,
              duration: taskEntry.completedAt - taskEntry.startedAt,
            });
            this._logger.info(`   ✅ Worker: "${taskEntry.name}" completado`);
            this._processQueue();
            break;

          case "error":
            taskEntry.status = "failed";
            taskEntry.completedAt = Date.now();
            taskEntry.error = msg.error;
            this._completed.push(taskEntry);
            this._activeWorkers.delete(workerId);
            this.emit("task:error", {
              taskId: taskEntry.id,
              name: taskEntry.name,
              error: msg.error,
            });
            this._logger.warn(`   ⚠️ Worker: "${taskEntry.name}" error: ${msg.error}`);
            this._processQueue();
            break;

          case "log":
            this._logger.info(`   [Worker ${taskEntry.name}] ${msg.text}`);
            break;
        }
      });

      // ── Handle worker exit ──
      workerProcess.on("exit", (code, signal) => {
        if (this._activeWorkers.has(workerId)) {
          // Unexpected exit
          taskEntry.status = "failed";
          taskEntry.error = `Worker exited (code: ${code}, signal: ${signal})`;
          this._completed.push(taskEntry);
          this._activeWorkers.delete(workerId);
          this.emit("task:error", {
            taskId: taskEntry.id,
            name: taskEntry.name,
            error: taskEntry.error,
          });
          this._processQueue();
        }
      });

      // ── Handle worker error ──
      workerProcess.on("error", (err) => {
        taskEntry.status = "failed";
        taskEntry.error = err.message;
        this._completed.push(taskEntry);
        this._activeWorkers.delete(workerId);
        this.emit("task:error", {
          taskId: taskEntry.id,
          name: taskEntry.name,
          error: err.message,
        });
        this._processQueue();
      });

      // ── Timeout ──
      setTimeout(() => {
        if (this._activeWorkers.has(workerId) && taskEntry.status === "running") {
          this._logger.warn(`   ⚠️ Worker: "${taskEntry.name}" timeout (${taskEntry.timeout}ms)`);
          try {
            workerProcess.kill("SIGKILL");
          } catch {}
          this._activeWorkers.delete(workerId);
          taskEntry.status = "failed";
          taskEntry.error = `Timeout after ${taskEntry.timeout}ms`;
          this._completed.push(taskEntry);
          this.emit("task:error", {
            taskId: taskEntry.id,
            name: taskEntry.name,
            error: taskEntry.error,
          });
          this._processQueue();
        }
      }, taskEntry.timeout);

      this._logger.info(`   🔧 Worker: "${taskEntry.name}" iniciado (${this.activeCount}/${this._maxWorkers})`);
      this.emit("task:started", { taskId: taskEntry.id, name: taskEntry.name });

    } catch (err) {
      this._logger.warn(`   ⚠️ Error iniciando worker: ${err.message}`);
      taskEntry.status = "failed";
      taskEntry.error = err.message;
      this._completed.push(taskEntry);
      this.emit("task:error", { taskId: taskEntry.id, name: taskEntry.name, error: err.message });
    }
  }

  /**
   * Processes the queue — starts tasks whose dependencies are met.
   */
  _processQueue() {
    const remaining = [];

    for (const task of this._queue) {
      const depsMet = task.dependsOn.every((depId) =>
        this._completed.some((c) => c.id === depId && c.status === "completed")
      );

      if (depsMet && this.hasCapacity) {
        this._startWorker(task);
      } else {
        remaining.push(task);
      }
    }

    this._queue = remaining;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {WorkerPool|null} */
let _defaultInstance = null;

/**
 * Gets or creates the default WorkerPool instance.
 * @param {object} [options]
 * @returns {WorkerPool}
 */
export function getWorkerPool(options = {}) {
  if (!_defaultInstance) {
    _defaultInstance = new WorkerPool(options);
  }
  return _defaultInstance;
}

/**
 * Resets the default instance (useful for testing).
 */
export function resetWorkerPool() {
  if (_defaultInstance) {
    _defaultInstance.shutdown().catch(() => {});
    _defaultInstance = null;
  }
}
