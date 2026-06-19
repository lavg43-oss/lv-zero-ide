/**
 * lv-zero — Persistent Settings Store
 *
 * Phase 6: Provides a persistent key-value store for application settings
 * using better-sqlite3. Values are JSON-serialized. The database is stored
 * in the userData directory alongside the secret storage database.
 *
 * Table schema:
 *   CREATE TABLE settings (
 *     key TEXT PRIMARY KEY,
 *     value TEXT NOT NULL,
 *     updated_at TEXT DEFAULT CURRENT_TIMESTAMP
 *   )
 */

const path = require('path');
const fs = require('fs');

class SettingsStore {
  /**
   * @param {string} dbPath - Path to the SQLite database file
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this._initialized = false;
  }

  /**
   * Initialize the SQLite database and create the table if needed.
   * Must be called before any other method.
   */
  init() {
    if (this._initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize better-sqlite3
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');

    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this._initialized = true;
    console.log(`[SettingsStore] Initialized at ${this.dbPath}`);
  }

  /**
   * Get a setting value by key.
   * Returns the parsed value, or null if the key doesn't exist.
   *
   * @param {string} key - Setting key
   * @returns {*} Parsed value or null
   */
  get(key) {
    if (!this._initialized) this.init();
    if (!key) return null;

    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    if (!row) return null;

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  /**
   * Set a setting value by key.
   * Values are JSON-serialized before storage.
   *
   * @param {string} key - Setting key
   * @param {*} value - Value to store (will be JSON-serialized)
   * @returns {boolean} True on success
   */
  set(key, value) {
    if (!this._initialized) this.init();
    if (!key) return false;

    const serialized = JSON.stringify(value);
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    );
    stmt.run(key, serialized);
    return true;
  }

  /**
   * Get all settings as a plain object.
   *
   * @returns {Object} All settings key-value pairs
   */
  getAll() {
    if (!this._initialized) this.init();

    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all();
    const result = {};

    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }

    return result;
  }

  /**
   * Delete a setting by key.
   *
   * @param {string} key - Setting key to delete
   * @returns {boolean} True if deleted, false if key didn't exist
   */
  delete(key) {
    if (!this._initialized) this.init();
    if (!key) return false;

    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }

  /**
   * Clear all settings.
   */
  clear() {
    if (!this._initialized) this.init();

    this.db.exec('DELETE FROM settings');
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._initialized = false;
    }
  }
}

module.exports = { SettingsStore };
