/**
 * LocalVectorStore — Local vector store using better-sqlite3
 *
 * Provides cosine similarity search over stored embeddings without any
 * external vector database dependency. Works entirely offline.
 *
 * Embeddings are stored as binary Float32Array blobs in SQLite.
 * Cosine similarity is computed in pure JavaScript.
 *
 * @module core/memory/local_vector
 */

const path = require('path');
const crypto = require('crypto');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.warn('[LocalVectorStore] better-sqlite3 not available:', err.message);
  Database = null;
}

class LocalVectorStore {
  /**
   * @param {string} dbPath - Path to the SQLite database file
   * @param {object} [options]
   * @param {number} [options.maxResults=10] - Default max results for search
   */
  constructor(dbPath, options = {}) {
    if (!Database) {
      throw new Error(
        '[LocalVectorStore] better-sqlite3 is not available. Cannot create vector store.'
      );
    }

    this.maxResults = options.maxResults || 10;
    this._dbPath = dbPath;

    // Ensure directory exists
    const fs = require('fs');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._initSchema();
    this._prepareStatements();

    console.log(`[LocalVectorStore] Initialized at ${dbPath}`);
  }

  /**
   * Create the vectors table if it doesn't exist.
   */
  _initSchema() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Precompile frequently used statements.
   */
  _prepareStatements() {
    this._stmtInsert = this._db.prepare(`
      INSERT INTO vectors (text, embedding, metadata)
      VALUES (@text, @embedding, @metadata)
    `);

    this._stmtGetById = this._db.prepare('SELECT * FROM vectors WHERE id = ?');

    this._stmtDeleteById = this._db.prepare('DELETE FROM vectors WHERE id = ?');

    this._stmtClear = this._db.prepare('DELETE FROM vectors');

    this._stmtCount = this._db.prepare('SELECT COUNT(*) as count FROM vectors');

    this._stmtAll = this._db.prepare('SELECT * FROM vectors ORDER BY id DESC');
  }

  /**
   * Convert a Float32Array to a Buffer for storage.
   * @param {Float32Array} float32Array
   * @returns {Buffer}
   */
  _embeddingToBuffer(float32Array) {
    return Buffer.from(float32Array.buffer);
  }

  /**
   * Convert a Buffer back to a Float32Array.
   * @param {Buffer} buffer
   * @returns {Float32Array}
   */
  _bufferToEmbedding(buffer) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  }

  /**
   * Compute cosine similarity between two Float32Arrays.
   * @param {Float32Array} a
   * @param {Float32Array} b
   * @returns {number} Cosine similarity (-1 to 1)
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Generate a simple hash-based embedding as fallback when no OpenAI/embedding
   * model is available. Produces a 384-dimensional vector using feature hashing.
   *
   * This is NOT semantically meaningful — it's a last-resort fallback so the
   * vector store can still function without any external embedding API.
   *
   * @param {string} text
   * @param {number} [dimensions=384]
   * @returns {Float32Array}
   */
  _hashEmbedding(text, dimensions = 384) {
    const vector = new Float32Array(dimensions);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);

    for (const word of words) {
      const hash = crypto.createHash('md5').update(word).digest();
      // Use first 4 bytes for bucket index, next bytes for sign
      for (let i = 0; i < 4; i++) {
        const bucket = (hash[i] * 256 + hash[i + 1]) % dimensions;
        const sign = (hash[i + 2] % 2 === 0) ? 1 : -1;
        vector[bucket] += sign * (hash[i + 3] / 256);
      }
    }

    // Normalize the vector
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * Generate an embedding for text using the OpenAI SDK if available,
   * falling back to hash-based embedding.
   *
   * @param {string} text - Text to embed
   * @param {object} [options]
   * @param {string} [options.apiKey] - OpenAI API key
   * @param {string} [options.model='text-embedding-3-small'] - Embedding model
   * @param {string} [options.baseURL] - Custom API base URL
   * @returns {Promise<Float32Array>}
   */
  async generateEmbedding(text, options = {}) {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

    if (apiKey) {
      try {
        const { OpenAI } = await import('openai');
        const openai = new OpenAI({
          apiKey,
          baseURL: options.baseURL || process.env.OPENAI_BASE_URL || undefined,
        });

        const response = await openai.embeddings.create({
          model: options.model || 'text-embedding-3-small',
          input: text,
        });

        return new Float32Array(response.data[0].embedding);
      } catch (err) {
        console.warn(`[LocalVectorStore] OpenAI embedding failed: ${err.message}. Falling back to hash embedding.`);
      }
    }

    // Fallback to hash-based embedding
    return this._hashEmbedding(text);
  }

  /**
   * Store a text with its embedding vector and optional metadata.
   *
   * @param {string} text - The text content to store
   * @param {Float32Array|number[]} embedding - The embedding vector
   * @param {object} [metadata] - Optional metadata JSON
   * @returns {object} The stored row
   */
  addEmbedding(text, embedding, metadata) {
    // Convert to Float32Array if needed
    const float32 = embedding instanceof Float32Array
      ? embedding
      : new Float32Array(embedding);

    const buffer = this._embeddingToBuffer(float32);

    const result = this._stmtInsert.run({
      text,
      embedding: buffer,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return this._stmtGetById.get(result.lastInsertRowid);
  }

  /**
   * Search for the most similar stored vectors by cosine similarity.
   *
   * @param {string} query - The query text (for reference in results)
   * @param {Float32Array|number[]} embedding - The query embedding vector
   * @param {number} [limit] - Max results (default: this.maxResults)
   * @returns {Array<{id: number, text: string, metadata: object|null, score: number, created_at: string}>}
   */
  search(query, embedding, limit) {
    const maxResults = limit || this.maxResults;
    const queryFloat32 = embedding instanceof Float32Array
      ? embedding
      : new Float32Array(embedding);

    const allRows = this._stmtAll.all();
    const scored = [];

    for (const row of allRows) {
      const storedEmbedding = this._bufferToEmbedding(row.embedding);
      const similarity = this._cosineSimilarity(queryFloat32, storedEmbedding);

      scored.push({
        id: row.id,
        text: row.text,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        score: similarity,
        created_at: row.created_at,
      });
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults);
  }

  /**
   * Delete a vector entry by ID.
   *
   * @param {number} id
   * @returns {boolean} True if deleted
   */
  delete(id) {
    const result = this._stmtDeleteById.run(id);
    return result.changes > 0;
  }

  /**
   * Clear all vector entries.
   */
  clear() {
    this._stmtClear.run();
  }

  /**
   * Get the total number of stored vectors.
   *
   * @returns {number}
   */
  count() {
    const row = this._stmtCount.get();
    return row ? row.count : 0;
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this._db && this._db.open) {
      this._db.close();
      console.log('[LocalVectorStore] Database closed');
    }
  }
}

module.exports = { LocalVectorStore };
