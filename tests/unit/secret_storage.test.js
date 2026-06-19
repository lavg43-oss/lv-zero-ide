/**
 * Unit tests for SecretStorage
 *
 * Tests the secure credential vault that replaces plaintext .env storage.
 * Uses an in-memory SQLite database to avoid file system side effects.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import os from "os";
import { SecretStorage } from "../../src/secret_storage.js";

/**
 * Helper: create a SecretStorage instance backed by an in-memory SQLite db.
 * We override init() to use a temporary database so tests don't touch disk.
 */
function createTestStorage() {
  const storage = new SecretStorage(":memory:");
  // Override init to use an in-memory database directly
  storage.init = async function () {
    if (this._initialized) return;
    this.db = new Database(":memory:");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        service TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this._initialized = true;
  };
  return storage;
}

describe("SecretStorage", () => {
  let storage;

  beforeEach(async () => {
    storage = createTestStorage();
    await storage.init();
  });

  afterEach(() => {
    if (storage.db) {
      storage.db.close();
      storage.db = null;
      storage._initialized = false;
    }
  });

  // ─── saveKey / getKey roundtrip ───────────────────────────────────────

  it("should save and retrieve a key", async () => {
    const saveResult = await storage.saveKey("test-service", "sk-abc123");
    expect(saveResult.success).toBe(true);

    const getResult = await storage.getKey("test-service");
    expect(getResult.success).toBe(true);
    expect(getResult.key).toBe("sk-abc123");
  });

  it("should roundtrip multiple keys correctly", async () => {
    await storage.saveKey("service-a", "key-a-value");
    await storage.saveKey("service-b", "key-b-value");

    const resultA = await storage.getKey("service-a");
    expect(resultA.key).toBe("key-a-value");

    const resultB = await storage.getKey("service-b");
    expect(resultB.key).toBe("key-b-value");
  });

  it("should overwrite an existing key on save", async () => {
    await storage.saveKey("test-service", "original-key");
    await storage.saveKey("test-service", "updated-key");

    const result = await storage.getKey("test-service");
    expect(result.key).toBe("updated-key");
  });

  // ─── listServices ─────────────────────────────────────────────────────

  it("should return an empty list when no services exist", async () => {
    const result = await storage.listServices();
    expect(result.success).toBe(true);
    expect(result.services).toEqual([]);
  });

  it("should list all stored services in alphabetical order", async () => {
    await storage.saveKey("zebra", "z-key");
    await storage.saveKey("alpha", "a-key");
    await storage.saveKey("beta", "b-key");

    const result = await storage.listServices();
    expect(result.services).toEqual(["alpha", "beta", "zebra"]);
  });

  // ─── deleteKey ────────────────────────────────────────────────────────

  it("should delete an existing key", async () => {
    await storage.saveKey("test-service", "sk-abc123");

    const deleteResult = await storage.deleteKey("test-service");
    expect(deleteResult.success).toBe(true);

    const getResult = await storage.getKey("test-service");
    expect(getResult.success).toBe(false);
    expect(getResult.error).toContain("No key found");
  });

  it("should return an error when deleting a non-existent key", async () => {
    const result = await storage.deleteKey("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("No key found");
  });

  // ─── hasKey ───────────────────────────────────────────────────────────

  it("should return true for an existing key", async () => {
    await storage.saveKey("test-service", "sk-abc123");
    const result = await storage.hasKey("test-service");
    expect(result.success).toBe(true);
    expect(result.hasKey).toBe(true);
  });

  it("should return false for a non-existent key", async () => {
    const result = await storage.hasKey("nonexistent");
    expect(result.success).toBe(true);
    expect(result.hasKey).toBe(false);
  });

  it("should return false after a key is deleted", async () => {
    await storage.saveKey("test-service", "sk-abc123");
    await storage.deleteKey("test-service");
    const result = await storage.hasKey("test-service");
    expect(result.hasKey).toBe(false);
  });

  // ─── Encryption verification ──────────────────────────────────────────

  it("should not store keys as plaintext in the database", async () => {
    await storage.saveKey("test-service", "my-secret-api-key");

    // Read raw value directly from the database
    const row = storage.db
      .prepare("SELECT encrypted_value FROM secrets WHERE service = ?")
      .get("test-service");

    expect(row).toBeTruthy();
    expect(row.encrypted_value).not.toContain("my-secret-api-key");
    expect(row.encrypted_value).not.toBe("my-secret-api-key");

    // The encrypted value should be a base64 string (longer than the original)
    expect(row.encrypted_value.length).toBeGreaterThan("my-secret-api-key".length);
    // Base64 pattern
    expect(row.encrypted_value).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("should produce different ciphertexts for the same plaintext (IV randomness)", async () => {
    await storage.saveKey("svc1", "same-value");
    await storage.saveKey("svc2", "same-value");

    const row1 = storage.db
      .prepare("SELECT encrypted_value FROM secrets WHERE service = ?")
      .get("svc1");
    const row2 = storage.db
      .prepare("SELECT encrypted_value FROM secrets WHERE service = ?")
      .get("svc2");

    // Each encryption should have a different IV, so ciphertexts differ
    expect(row1.encrypted_value).not.toBe(row2.encrypted_value);
  });

  // ─── Error handling for invalid inputs ────────────────────────────────

  it("should reject saving with an empty service name", async () => {
    const result = await storage.saveKey("", "some-key");
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject saving with a null service name", async () => {
    const result = await storage.saveKey(null, "some-key");
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject saving with an empty key", async () => {
    const result = await storage.saveKey("test-service", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject saving with a null key", async () => {
    const result = await storage.saveKey("test-service", null);
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject getting a key with an empty service name", async () => {
    const result = await storage.getKey("");
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject deleting with an empty service name", async () => {
    const result = await storage.deleteKey("");
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject hasKey with an empty service name", async () => {
    const result = await storage.hasKey("");
    expect(result.success).toBe(false);
    expect(result.hasKey).toBe(false);
  });

  // ─── close ────────────────────────────────────────────────────────────

  it("should close the database connection", () => {
    expect(storage.db).toBeTruthy();
    storage.close();
    expect(storage.db).toBeNull();
    expect(storage._initialized).toBe(false);
  });
});
