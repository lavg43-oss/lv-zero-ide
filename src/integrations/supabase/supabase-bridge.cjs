/**
 * lv-zero — Supabase Bridge (Phase 8: External Integrations)
 *
 * Supabase REST API client using built-in https module.
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env.
 * Modeled after Antigravity's supabase-database skill.
 *
 * All functions return { ok: bool, data/error }.
 * All wrapped in try/catch for graceful degradation.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

// ─── Internal HTTP helper ────────────────────────────────────────────────────

/**
 * Make an HTTP(S) request and return parsed JSON response.
 * @param {string} method - HTTP method
 * @param {string} urlStr - Full URL
 * @param {object} [headers] - Additional headers
 * @param {string} [body] - Request body string
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
function _request(method, urlStr, headers = {}, body = null) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(urlStr);
      const lib = parsedUrl.protocol === "https:" ? https : http;
      const options = {
        method,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        timeout: 15000,
      };

      if (body) {
        options.headers["Content-Length"] = Buffer.byteLength(body, "utf8");
      }

      const req = lib.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ ok: true, data: parsed });
            } else {
              resolve({ ok: false, error: parsed ? parsed.message || parsed.error || JSON.stringify(parsed) : `HTTP ${res.statusCode}` });
            }
          } catch (parseErr) {
            resolve({ ok: false, error: `Failed to parse response: ${parseErr.message}` });
          }
        });
      });

      req.on("error", (err) => {
        resolve({ ok: false, error: `Request failed: ${err.message}` });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "Request timed out after 15s" });
      });

      if (body) {
        req.write(body);
      }
      req.end();
    } catch (err) {
      resolve({ ok: false, error: `Request setup failed: ${err.message}` });
    }
  });
}

// ─── Client Factory ──────────────────────────────────────────────────────────

/**
 * Create a Supabase client instance.
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env.
 * @returns {{ ok: boolean, client?: object, error?: string }}
 */
function getSupabaseClient() {
  try {
    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!url) {
      return { ok: false, error: "SUPABASE_URL environment variable not set" };
    }
    if (!key) {
      return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY environment variable not set" };
    }

    const baseUrl = url.replace(/\/+$/, "");
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
    };

    const client = {
      _baseUrl: baseUrl,
      _headers: headers,

      /**
       * Query a table with optional filters, limit, and ordering.
       * @param {string} table - Table name
       * @param {object} [options] - Query options
       * @param {string} [options.select] - Columns to select (default: "*")
       * @param {object} [options.filters] - Key-value filter pairs
       * @param {number} [options.limit] - Max rows
       * @param {object|string} [options.order] - Column and direction (e.g., "created_at.desc")
       * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
       */
      async query(table, options = {}) {
        try {
          let path = `/rest/v1/${table}`;
          const params = new URLSearchParams();
          params.set("select", options.select || "*");

          if (options.filters) {
            for (const [col, val] of Object.entries(options.filters)) {
              params.set(col, `eq.${val}`);
            }
          }
          if (options.limit) {
            params.set("limit", String(options.limit));
          }
          if (options.order) {
            const ord = typeof options.order === "string"
              ? options.order
              : `${options.order.column || "created_at"}.${options.order.direction || "asc"}`;
            params.set("order", ord);
          }

          const qs = params.toString();
          const fullUrl = `${baseUrl}${path}?${qs}`;
          return await _request("GET", fullUrl, headers);
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },

      /**
       * Insert one or more rows into a table.
       * @param {string} table - Table name
       * @param {object|object[]} rows - Row data (single object or array)
       * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
       */
      async insert(table, rows) {
        try {
          const path = `/rest/v1/${table}`;
          const fullUrl = `${baseUrl}${path}`;
          const body = JSON.stringify(Array.isArray(rows) ? rows : [rows]);
          return await _request("POST", fullUrl, {
            ...headers,
            Prefer: "return=representation",
          }, body);
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },

      /**
       * Update rows in a table by matching an ID column.
       * @param {string} table - Table name
       * @param {string|number} id - Row ID value
       * @param {object} changes - Column-value pairs to update
       * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
       */
      async update(table, id, changes) {
        try {
          const path = `/rest/v1/${table}`;
          const fullUrl = `${baseUrl}${path}?id=eq.${id}`;
          const body = JSON.stringify(changes);
          return await _request("PATCH", fullUrl, {
            ...headers,
            Prefer: "return=representation",
          }, body);
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },

      /**
       * Execute a raw SQL query via the pg_query RPC endpoint.
       * This mirrors Antigravity's approach of using /rest/v1/rpc/pg_query.
       * @param {string} sqlQuery - Raw SQL statement
       * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
       */
      async sql(sqlQuery) {
        try {
          const path = "/rest/v1/rpc/pg_query";
          const fullUrl = `${baseUrl}${path}`;
          const body = JSON.stringify({ query_text: sqlQuery });
          return await _request("POST", fullUrl, headers, body);
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },

      /**
       * Fetch the database schema via the OpenAPI spec endpoint.
       * Uses /rest/v1/?apikey=... to get table definitions.
       * @returns {Promise<{ok: boolean, tables?: object, error?: string}>}
       */
      async schema() {
        try {
          const path = "/rest/v1/";
          const fullUrl = `${baseUrl}${path}?apikey=${key}`;
          const result = await _request("GET", fullUrl, headers);
          if (result.ok) {
            // Extract table definitions from the OpenAPI spec paths
            const spec = result.data;
            const tables = {};
            if (spec && spec.paths) {
              for (const p of Object.keys(spec.paths)) {
                const match = p.match(/^\/rest\/v1\/(\w+)/);
                if (match && match[1]) {
                  tables[match[1]] = spec.paths[p];
                }
              }
            }
            return { ok: true, tables };
          }
          return result;
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },
    };

    return { ok: true, client };
  } catch (err) {
    return { ok: false, error: `Failed to create Supabase client: ${err.message}` };
  }
}

module.exports = { getSupabaseClient };
