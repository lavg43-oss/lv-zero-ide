/**
 * supabase_sql — SQL Maestro v2.1
 *
 * Ejecuta SQL directo contra Supabase usando:
 * - RPC pg_query (vía service_role_key) → recomendado
 * - PostgreSQL directo (pg driver) si DATABASE_URL está configurada
 *
 * v2.1 — Ahora usa pg_query RPC como método principal
 */
export default {
  name: "supabase_sql",
  description:
    "SQL directo en Supabase para tu PROYECTO. Usa SUPABASE_URL/KEY del .env. " +
    "Para otra BD, pasa url y key explícitamente. NUNCA uses LV_SUPABASE_*.",

  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "Sentencia SQL a ejecutar.",
      },
      description: {
        type: "string",
        description: "Descripción de la consulta (para logging).",
      },
      url: {
        type: "string",
        description: "Opcional: URL de Supabase. Si no se proporciona, usa SUPABASE_URL del .env.",
      },
      service_role_key: {
        type: "string",
        description: "Opcional: Service role key. Si no se proporciona, usa SUPABASE_SERVICE_ROLE_KEY del .env.",
      },
      anon_key: {
        type: "string",
        description: "Opcional: Anon key. Si no se proporciona, usa SUPABASE_KEY del .env.",
      },
    },
    required: ["sql"],
  },

  handler: async ({ sql, description = "consulta SQL", url: explicitUrl, service_role_key: explicitKey }) => {
    // Project skills use SUPABASE_* by default. Pass explicit url/key to override.
    const supabaseUrl = explicitUrl || process.env.SUPABASE_URL;
    const serviceKey = explicitKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!sql || sql.trim().length === 0) {
      return { success: false, error: "SQL no puede estar vacío." };
    }

    if (!supabaseUrl || !serviceKey) {
      return {
        success: false,
        error: "SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridos en .env para el proyecto.",
        requiresUserInput: true,
      };
    }

    try {
      // ── Método 1: RPC pg_query ───────────────────────────────────────
      let response = await fetch(`${supabaseUrl}/rest/v1/rpc/pg_query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query_text: sql }),
      });

      let result = await response.json();

      // ── Fallback: si pg_query no existe, probar exec_sql ─────────────
      if (!response.ok && (response.status === 404 || (result.message && result.message.includes('Could not find the function')))) {
        console.warn(`[supabase_sql] pg_query RPC not found (404), falling back to exec_sql for: ${description}`);
        response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ query_text: sql }),
        });
        result = await response.json();
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${result.message || JSON.stringify(result)}`,
          sql: sql.substring(0, 200),
          description,
        };
      }

      return {
        success: result.success !== false,
        sql: sql.substring(0, 200) + (sql.length > 200 ? "..." : ""),
        description,
        method: "pg_query_rpc",
        data: result.data || null,
        result: result.success ? (result.data || "Ejecutado") : result.error,
        rowsAffected: result.data ? result.data.length : "unknown",
      };
    } catch (err) {
      return {
        success: false,
        error: `Error: ${err.message}`,
        sql: sql.substring(0, 200),
        description,
      };
    }
  },
};
