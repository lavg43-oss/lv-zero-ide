/**
 * telemetry/collector — Opt-in Anonymous Usage Telemetry
 *
 * Phase 12: Telemetry & Analytics (gstack-inspired)
 *
 * Tracks skill usage, duration, success/fail rates.
 * Data is stored locally in SQLite. No data is sent externally.
 * All telemetry is opt-in and can be disabled via TELEMETRY_OPT_OUT=true.
 *
 * @module telemetry/collector
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TELEMETRY_DB_PATH = path.resolve(__dirname, "..", "..", ".lv-zero", "telemetry.json");
const MAX_ENTRIES = 10000;

class TelemetryCollector extends EventEmitter {
  constructor() {
    super();
    this._enabled = process.env.TELEMETRY_OPT_OUT !== "true" && process.env.TELEMETRY_OPT_OUT !== "1";
    this._entries = [];
    this._loaded = false;
  }

  get enabled() {
    return this._enabled;
  }

  /**
   * Enables or disables telemetry.
   * @param {boolean} val
   */
  setEnabled(val) {
    this._enabled = val;
    if (!val) this._entries = [];
  }

  /**
   * Loads persisted telemetry data.
   */
  _load() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      if (fs.existsSync(TELEMETRY_DB_PATH)) {
        const raw = fs.readFileSync(TELEMETRY_DB_PATH, "utf-8");
        this._entries = JSON.parse(raw);
        if (!Array.isArray(this._entries)) this._entries = [];
      }
    } catch {
      this._entries = [];
    }
  }

  /**
   * Persists telemetry data to disk.
   */
  _save() {
    try {
      const dir = path.dirname(TELEMETRY_DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TELEMETRY_DB_PATH, JSON.stringify(this._entries.slice(-MAX_ENTRIES)), "utf-8");
    } catch {
      // Non-critical
    }
  }

  /**
   * Records a skill usage event.
   * @param {object} event
   * @param {string} event.skill - Skill name
   * @param {string} event.action - Action performed
   * @param {boolean} event.success - Whether it succeeded
   * @param {number} event.durationMs - Duration in ms
   * @param {string} [event.error] - Error message if failed
   */
  track(event) {
    if (!this._enabled) return;
    this._load();

    this._entries.push({
      ...event,
      timestamp: Date.now(),
      sessionId: global.__session_id || "unknown",
    });

    this.emit("tracked", event);

    // Persist every 10 entries
    if (this._entries.length % 10 === 0) {
      this._save();
    }
  }

  /**
   * Returns aggregated statistics.
   * @returns {object}
   */
  getStats() {
    this._load();

    const total = this._entries.length;
    const bySkill = {};
    const successes = this._entries.filter((e) => e.success).length;
    const failures = this._entries.filter((e) => !e.success).length;

    for (const entry of this._entries) {
      if (!bySkill[entry.skill]) {
        bySkill[entry.skill] = { total: 0, successes: 0, failures: 0, totalDuration: 0 };
      }
      bySkill[entry.skill].total++;
      if (entry.success) bySkill[entry.skill].successes++;
      else bySkill[entry.skill].failures++;
      bySkill[entry.skill].totalDuration += entry.durationMs || 0;
    }

    // Calculate averages
    for (const [name, stats] of Object.entries(bySkill)) {
      stats.avgDurationMs = stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : 0;
      stats.successRate = stats.total > 0 ? Math.round((stats.successes / stats.total) * 100) : 0;
    }

    return {
      enabled: this._enabled,
      total,
      successes,
      failures,
      successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
      bySkill,
      topSkills: Object.entries(bySkill)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([name, stats]) => ({ name, ...stats })),
    };
  }

  /**
   * Clears all telemetry data.
   */
  clear() {
    this._entries = [];
    this._save();
  }
}

const collector = new TelemetryCollector();
export default collector;
