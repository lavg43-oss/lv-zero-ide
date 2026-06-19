/**
 * 📇 file_indexer — Supabase-based File Metadata Index
 *
 * Stores file metadata (path, hash, size, mtime) in Supabase for change
 * detection and quick lookups. No content summary generation — just
 * hash-based change tracking.
 *
 * Usage:
 *   import { indexFile, getFileIndex, searchFiles } from "./file_indexer.js";
 *
 *   await indexFile("src/main.js", fileContent);
 *   const entry = await getFileIndex("src/main.js");
 *   const results = await searchFiles("main");
 */

import { createHash } from "crypto";

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 TABLE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
//
// CREATE TABLE IF NOT EXISTS file_index (
//   path            TEXT PRIMARY KEY,
//   hash            TEXT NOT NULL,
//   size            BIGINT NOT NULL,
//   mtime           TIMESTAMPTZ,
//   content_preview TEXT DEFAULT '',
//   last_indexed    TIMESTAMPTZ DEFAULT NOW()
// );
//
// ═══════════════════════════════════════════════════════════════════════════════

const TABLE_NAME = "file_index";

/**
 * Get Supabase config from environment.
 * Returns null if not configured.
 *
 * ALWAYS uses LV_SUPABASE_* (LV-Zero's own project) for file indexing.
 * Never uses plain SUPABASE_* which may point to a different project
 * (e.g., SIAE) after .env_siae is loaded.
 */
function getConfig() {
  const url = process.env.LV_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.LV_SUPABASE_KEY || process.env.SUPABASE_KEY || process.env.LV_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Create a lazy Supabase client on first use.
 * @returns {Promise<object|null>} Supabase client or null if not configured
 */
let _supabase = null;
let _supabasePromise = null;

async function getClient() {
  if (_supabase) return _supabase;
  if (_supabasePromise) return _supabasePromise;

  _supabasePromise = (async () => {
    const config = getConfig();
    if (!config) {
      _supabase = null;
      return null;
    }
    try {
      const { createClient } = await import("@supabase/supabase-js");
      _supabase = createClient(config.url, config.key);
      return _supabase;
    } catch {
      _supabase = null;
      return null;
    }
  })();

  return _supabasePromise;
}

/**
 * Reset the cached client (useful for testing).
 */
export function _resetClient() {
  _supabase = null;
  _supabasePromise = null;
}

/**
 * Compute a SHA-256 hex hash of a string.
 * @param {string} content
 * @returns {string}
 */
function computeHash(content) {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Ensure the file_index table exists.
 * Uses pg_query RPC to create the table if it doesn't exist.
 * This is a no-op if Supabase is not configured.
 *
 * @returns {Promise<boolean>} - true if table exists or was created
 */
export async function ensureTable() {
  const config = getConfig();
  if (!config) return false;

  const sql = `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      path          TEXT PRIMARY KEY,
      hash          TEXT NOT NULL,
      size          BIGINT NOT NULL,
      mtime         TIMESTAMPTZ,
      content_preview TEXT DEFAULT '',
      last_indexed  TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/pg_query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ query_text: sql }),
    });
    const result = await response.json();
    return result.success !== false;
  } catch {
    return false;
  }
}

/**
 * Index a file: upsert its metadata into Supabase.
 *
 * Stores: relative path, SHA-256 hash of content, file size, mtime,
 * and a short content preview (first 200 chars) for search.
 *
 * This is a fire-and-forget operation — it won't block the caller.
 *
 * @param {string} filePath - Relative or absolute file path
 * @param {string} content - File content (as string)
 * @param {object} [options]
 * @param {number} [options.size] - File size in bytes (optional, from stat)
 * @param {string} [options.mtime] - ISO mtime string (optional, from stat)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function indexFile(filePath, content, options = {}) {
  const client = await getClient();
  if (!client) {
    return { success: false, error: "Supabase no configurado" };
  }

  const hash = computeHash(content);
  const preview = content.replace(/[\x00-\x1F]/g, " ").substring(0, 200).trim();
  const size = options.size ?? Buffer.byteLength(content, "utf-8");
  const mtime = options.mtime ?? new Date().toISOString();

  try {
    const { error } = await client.from(TABLE_NAME).upsert(
      {
        path: filePath,
        hash,
        size,
        mtime,
        content_preview: preview,
        last_indexed: new Date().toISOString(),
      },
      { onConflict: "path" }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get the stored index entry for a file.
 *
 * @param {string} filePath - File path to look up
 * @returns {Promise<{ success: boolean, entry?: object, error?: string }>}
 */
export async function getFileIndex(filePath) {
  const client = await getClient();
  if (!client) {
    return { success: false, error: "Supabase no configurado" };
  }

  try {
    const { data, error } = await client
      .from(TABLE_NAME)
      .select("*")
      .eq("path", filePath)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, entry: data || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check if a file has changed since it was last indexed.
 * Compares current content hash with stored hash.
 *
 * @param {string} filePath - File path to check
 * @param {string} content - Current file content
 * @returns {Promise<{ changed: boolean, entry?: object }>}
 */
export async function hasFileChanged(filePath, content) {
  const result = await getFileIndex(filePath);
  if (!result.success || !result.entry) {
    return { changed: true }; // not indexed → changed
  }

  const currentHash = computeHash(content);
  return {
    changed: currentHash !== result.entry.hash,
    entry: result.entry,
  };
}

/**
 * Search indexed files by path prefix or content preview.
 *
 * @param {string} query - Search term (matched against path and content_preview)
 * @param {object} [options]
 * @param {number} [options.limit=20] - Max results
 * @returns {Promise<{ success: boolean, results?: Array<object>, error?: string }>}
 */
export async function searchFiles(query, options = {}) {
  const client = await getClient();
  if (!client) {
    return { success: false, error: "Supabase no configurado" };
  }

  const limit = options.limit ?? 20;

  try {
    const { data, error } = await client
      .from(TABLE_NAME)
      .select("path, size, mtime, last_indexed")
      .or(`path.ilike.%${query}%,content_preview.ilike.%${query}%`)
      .order("last_indexed", { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, results: data || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Index multiple files in batch.
 * Fire-and-forget — runs all promises concurrently.
 *
 * @param {Array<{ path: string, content: string, size?: number, mtime?: string }>} files
 * @returns {Promise<Array<{ path: string, success: boolean, error?: string }>>}
 */
export async function indexFiles(files) {
  const results = await Promise.allSettled(
    files.map((f) => indexFile(f.path, f.content, { size: f.size, mtime: f.mtime }))
  );

  return files.map((f, i) => ({
    path: f.path,
    success: results[i].status === "fulfilled" && results[i].value.success,
    error: results[i].status === "rejected" ? results[i].reason?.message : results[i].value?.error,
  }));
}

const description = 'Indexa y cataloga archivos del proyecto. Genera un índice estructurado de todos los archivos con metadatos (tipo, tamaño, fecha). Úsala cuando el usuario diga "indexa el proyecto", "cataloga los archivos", "muéstrame la estructura del proyecto".';

const parameters = {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['index', 'search', 'get', 'check', 'batch', 'ensure_table'],
            description: 'Acción a ejecutar'
        },
        filePath: { type: 'string', description: 'Ruta del archivo a indexar' },
        content: { type: 'string', description: 'Contenido del archivo' },
        query: { type: 'string', description: 'Término de búsqueda' },
        files: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array de { path, content, size?, mtime? } para indexación batch'
        }
    },
    required: ['action']
};

async function handler(args) {
    const { action, filePath, content, query, files, options } = args || {};
    switch (action) {
        case 'index':
            return await indexFile(filePath, content, options);
        case 'search':
            return await searchFiles(query, options);
        case 'get':
            return await getFileIndex(filePath);
        case 'check':
            return await hasFileChanged(filePath, content);
        case 'batch':
            return await indexFiles(files || []);
        case 'ensure_table':
            return { success: await ensureTable() };
        default:
            return { success: false, error: `Acción desconocida: "${action}". Usa: index, search, get, check, batch, ensure_table` };
    }
}

export default {
    name: 'file_indexer',
    description,
    parameters,
    handler
};
