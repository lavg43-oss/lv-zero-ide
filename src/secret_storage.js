/**
 * lv-zero — Secret Storage System
 *
 * Phase 0.1: Secure credential vault that replaces plaintext .env storage
 * for API keys. Uses Electron's safeStorage API for encryption and
 * better-sqlite3 for persistence.
 *
 * Supports both Electron mode (safeStorage) and CLI mode (crypto fallback).
 */

const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ─── Pepper for fallback key derivation ─────────────────────────────────────
const FALLBACK_PEPPER = "lv-zero-secret-storage-v1";

class SecretStorage {
  /**
   * @param {string} dbPath - Path to the SQLite database file
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this._safeStorage = null;
    this._isElectron = false;
    this._initialized = false;
  }

  /**
   * Initialize the SQLite database and detect environment.
   * Must be called before any other method.
   */
  async init() {
    if (this._initialized) return;

    // Detect Electron safeStorage
    try {
      const electron = require("electron");
      if (electron && electron.safeStorage) {
        this._safeStorage = electron.safeStorage;
        this._isElectron = true;
      }
    } catch {
      // Not in Electron — use crypto fallback
      this._isElectron = false;
    }

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize better-sqlite3
    const Database = require("better-sqlite3");
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma("journal_mode = WAL");

    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        service TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this._initialized = true;
    console.log(`[SecretStorage] Initialized at ${this.dbPath} (electron=${this._isElectron})`);
  }

  /**
   * Encrypt a plaintext value.
   * Uses Electron safeStorage if available, otherwise falls back to AES-256-GCM.
   *
   * @param {string} plaintext - The value to encrypt
   * @returns {string} Base64-encoded encrypted data
   */
  _encrypt(plaintext) {
    if (this._isElectron && this._safeStorage && this._safeStorage.isEncryptionAvailable()) {
      // Electron safeStorage
      const buffer = this._safeStorage.encryptString(plaintext);
      return buffer.toString("base64");
    }

    // Fallback: AES-256-GCM with derived key
    return this._fallbackEncrypt(plaintext);
  }

  /**
   * Decrypt an encrypted value.
   *
   * @param {string} encryptedBase64 - Base64-encoded encrypted data
   * @returns {string} Decrypted plaintext
   */
  _decrypt(encryptedBase64) {
    if (this._isElectron && this._safeStorage && this._safeStorage.isEncryptionAvailable()) {
      // Electron safeStorage
      const buffer = Buffer.from(encryptedBase64, "base64");
      return this._safeStorage.decryptString(buffer);
    }

    // Fallback: AES-256-GCM with derived key
    return this._fallbackDecrypt(encryptedBase64);
  }

  /**
   * Derive an AES-256 key from machine-specific seed.
   * Uses hostname + OS user + hardcoded pepper.
   *
   * @returns {Buffer} 32-byte key
   */
  _deriveKey() {
    const seed = `${os.hostname()}:${os.userInfo().username}:${FALLBACK_PEPPER}`;
    return crypto.createHash("sha256").update(seed).digest();
  }

  /**
   * Fallback encryption using AES-256-GCM.
   * Format: base64( iv + authTag + ciphertext )
   *
   * @param {string} plaintext
   * @returns {string} Base64-encoded encrypted payload
   */
  _fallbackEncrypt(plaintext) {
    const key = this._deriveKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "binary");
    encrypted += cipher.final("binary");

    const authTag = cipher.getAuthTag();

    // Concatenate: iv (12) + authTag (16) + ciphertext
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, "binary"),
    ]);

    return combined.toString("base64");
  }

  /**
   * Fallback decryption using AES-256-GCM.
   *
   * @param {string} encryptedBase64
   * @returns {string} Decrypted plaintext
   */
  _fallbackDecrypt(encryptedBase64) {
    const key = this._deriveKey();
    const combined = Buffer.from(encryptedBase64, "base64");

    // Extract: iv (12) + authTag (16) + ciphertext (rest)
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "binary", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Encrypt and store a key for a service.
   *
   * @param {string} service - Service name (e.g., "deepseek", "openai")
   * @param {string} key - The API key to store
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveKey(service, key) {
    try {
      if (!this._initialized) await this.init();
      if (!service || !key) {
        return { success: false, error: "Service name and key are required" };
      }

      const encrypted = this._encrypt(key);

      const stmt = this.db.prepare(
        "INSERT OR REPLACE INTO secrets (service, encrypted_value, created_at) VALUES (?, ?, datetime('now'))"
      );
      stmt.run(service, encrypted);

      console.log(`[SecretStorage] Key saved for service: ${service}`);
      return { success: true };
    } catch (err) {
      console.error(`[SecretStorage] Error saving key for ${service}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Retrieve and decrypt a key for a service.
   *
   * @param {string} service - Service name
   * @returns {Promise<{success: boolean, key?: string, error?: string}>}
   */
  async getKey(service) {
    try {
      if (!this._initialized) await this.init();
      if (!service) {
        return { success: false, error: "Service name is required" };
      }

      const stmt = this.db.prepare("SELECT encrypted_value FROM secrets WHERE service = ?");
      const row = stmt.get(service);

      if (!row) {
        return { success: false, error: `No key found for service: ${service}` };
      }

      const decrypted = this._decrypt(row.encrypted_value);
      return { success: true, key: decrypted };
    } catch (err) {
      console.error(`[SecretStorage] Error getting key for ${service}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * List all stored service names.
   *
   * @returns {Promise<{success: boolean, services?: string[], error?: string}>}
   */
  async listServices() {
    try {
      if (!this._initialized) await this.init();

      const stmt = this.db.prepare("SELECT service FROM secrets ORDER BY service");
      const rows = stmt.all();

      return {
        success: true,
        services: rows.map((r) => r.service),
      };
    } catch (err) {
      console.error("[SecretStorage] Error listing services:", err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete a stored key for a service.
   *
   * @param {string} service - Service name
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteKey(service) {
    try {
      if (!this._initialized) await this.init();
      if (!service) {
        return { success: false, error: "Service name is required" };
      }

      const stmt = this.db.prepare("DELETE FROM secrets WHERE service = ?");
      const result = stmt.run(service);

      if (result.changes === 0) {
        return { success: false, error: `No key found for service: ${service}` };
      }

      console.log(`[SecretStorage] Key deleted for service: ${service}`);
      return { success: true };
    } catch (err) {
      console.error(`[SecretStorage] Error deleting key for ${service}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if a key exists for a service.
   *
   * @param {string} service - Service name
   * @returns {Promise<{success: boolean, hasKey: boolean, error?: string}>}
   */
  async hasKey(service) {
    try {
      if (!this._initialized) await this.init();
      if (!service) {
        return { success: false, hasKey: false, error: "Service name is required" };
      }

      const stmt = this.db.prepare("SELECT COUNT(*) as count FROM secrets WHERE service = ?");
      const row = stmt.get(service);

      return { success: true, hasKey: row.count > 0 };
    } catch (err) {
      console.error(`[SecretStorage] Error checking key for ${service}:`, err.message);
      return { success: false, hasKey: false, error: err.message };
    }
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

module.exports = { SecretStorage };
