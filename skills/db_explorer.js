/**
 * db_explorer — Universal PostgreSQL Schema Explorer
 *
 * Conecta directamente a PostgreSQL usando DATABASE_URL.
 * Mapea dinámicamente tablas, columnas, tipos y relaciones.
 * No requiere hardcodeo de esquemas — todo es descubrimiento.
 *
 * v1.1 — May 2026: Fixed pooler hostname format (aws-0-<region>.pooler.supabase.com)
 */
import pg from "pg";

const { Client } = pg;

/**
 * Obtiene la DATABASE_URL del entorno.
 *
 * Orden de resolución (May 2026):
 *   1. DATABASE_URL — conexión directa (IPv6, o IPv4 add-on)
 *   2. SUPABASE_DB_URL — pooler session (IPv4 compatible)
 *   3. SUPABASE_REF + SUPABASE_DB_PASSWORD — construye pooler URL
 *   4. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — conexión directa desde URL
 *
 * Pooler format (IPv4):   aws-0-<region>.pooler.supabase.com:6543 (transaction mode)
 * Direct format (IPv6):   db.<project>.supabase.co:5432
 */
function getDbUrl() {
  // 1. Explicit DATABASE_URL (most direct — user provides full connection string)
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 2. Supabase pooler connection (IPv4 compatible — user provides complete string)
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;

  // 3. Build pooler URL from components (session pooler, IPv4 compatible)
  const ref = process.env.SUPABASE_REF || process.env.NEXT_PUBLIC_SUPABASE_REF;
  const region = process.env.SUPABASE_REGION || process.env.NEXT_PUBLIC_SUPABASE_REGION || "us-east-1";
  const password = process.env.SUPABASE_DB_PASSWORD || process.env.NEXT_PUBLIC_SUPABASE_DB_PASSWORD;

  if (ref && password) {
    // Transaction mode pooler — verified working on port 6543 (May 2026)
    // Session mode (5432) times out on some projects; 6543 is universal
    const host = `aws-0-${region}.pooler.supabase.com`;
    return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres?sslmode=require`;
  }

  // 4. Fallback: direct connection from SUPABASE_URL (requires IPv6 or IPv4 add-on)
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (url && key) {
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match) {
      const projectRef = match[1];
      return `postgresql://postgres:${encodeURIComponent(key)}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
    }
  }

  // 5. Alias/fallback for backward compatibility
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;

  throw new Error(
    "No Supabase connection info. Set DATABASE_URL, SUPABASE_DB_URL, " +
    "or SUPABASE_REF + SUPABASE_DB_PASSWORD in .env"
  );
}

/**
 * get_schema — Query que retorna TODAS las tablas y columnas públicas
 * en una estructura jerárquica de un solo golpe.
 */
const SCHEMA_QUERY = `
SELECT
  t.table_schema,
  t.table_name,
  t.table_type,
  json_agg(
    json_build_object(
      'column_name', c.column_name,
      'data_type', c.data_type,
      'is_nullable', c.is_nullable,
      'column_default', c.column_default,
      'character_maximum_length', c.character_maximum_length,
      'ordinal_position', c.ordinal_position
    ) ORDER BY c.ordinal_position
  ) AS columns
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema
  AND c.table_name = t.table_name
WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND t.table_type = 'BASE TABLE'
GROUP BY t.table_schema, t.table_name, t.table_type
ORDER BY t.table_schema, t.table_name;
`;

/**
 * Verifica si la conexión está viva, sin carga pesada.
 */
const PING_QUERY = "SELECT 1 AS alive";

/**
 * Conecta y ejecuta una consulta SQL arbitraria.
 * @param {string} sql - Consulta SQL a ejecutar.
 * @param {string[]} [params=[]] - Parámetros opcionales.
 * @param {string} [explicitUrl] - Connection string explícita (opcional). Si no se proporciona, usa getDbUrl().
 */
async function query(sql, params = [], explicitUrl) {
  const dbUrl = explicitUrl || getDbUrl();
  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL no configurada. Necesito la DATABASE_URL de Postgres en el archivo .env para mapear tu sistema."
    );
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }  // Required for Supabase pooler connections
  });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

export default {
  name: "db_explorer",
  description:
    "Explorador de BD para tu PROYECTO. Usa SUPABASE_* del .env. " +
    "Para otra BD, pasa connection_string explícitamente. NUNCA uses LV_SUPABASE_*.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "get_schema",
          "execute",
          "test_connection",
        ],
        description:
          '"get_schema": Devuelve todas las tablas y columnas públicas en una estructura jerárquica (table_schema, table_name, columns[]). ' +
          '"execute": Ejecuta una consulta SQL arbitraria. Requiere parámetro "sql". ' +
          '"test_connection": Verifica si la conexión a la BD es funcional.',
      },
      sql: {
        type: "string",
        description:
          "Consulta SQL a ejecutar (solo para action='execute'). " +
          "Debe ser SELECT o consulta de solo lectura.",
      },
      params: {
        type: "array",
        items: { type: "string" },
        description:
          "Parámetros opcionales para la consulta SQL (solo para action='execute').",
      },
      connection_string: {
        type: "string",
        description:
          "Opcional: Connection string PostgreSQL completo. " +
          "Si no se proporciona, usa DATABASE_URL o construye desde SUPABASE_* del .env.",
      },
    },
    required: ["action"],
  },

  handler: async ({ action, sql, params, connection_string }) => {
    try {
      // Si se proporcionó connection_string explícita, usarla como dbUrl
      const dbUrl = connection_string || getDbUrl();

      switch (action) {
        // ─── GET SCHEMA ────────────────────────────────────────────────
        case "get_schema": {
          if (!dbUrl) {
            return {
              success: false,
              error:
                "Necesito la DATABASE_URL de Postgres en el archivo .env para mapear tu sistema.",
              hint: "Agrega DATABASE_URL=postgresql://user:password@host:5432/dbname en tu archivo .env",
              failFast: true,
            };
          }

          const rows = await query(SCHEMA_QUERY, [], dbUrl);

          // Agrupar por schema
          const schemas = {};
          for (const row of rows) {
            const schema = row.table_schema;
            if (!schemas[schema]) {
              schemas[schema] = { schema, tables: [] };
            }
            schemas[schema].tables.push({
              name: row.table_name,
              type: row.table_type,
              columns: row.columns || [],
            });
          }

          const schemaList = Object.values(schemas);
          const totalTables = rows.length;
          const totalColumns = rows.reduce(
            (sum, r) => sum + (r.columns ? r.columns.length : 0),
            0
          );

          return {
            success: true,
            totalSchemas: schemaList.length,
            totalTables,
            totalColumns,
            schemas: schemaList,
            note: "Esquema mapeado dinámicamente. Usa estos nombres reales de tablas y columnas para tus consultas.",
          };
        }

        // ─── EXECUTE ────────────────────────────────────────────────────
        case "execute": {
          if (!sql) {
            return {
              success: false,
              error: "Se requiere el parámetro 'sql' para action='execute'.",
            };
          }

          if (!dbUrl) {
            return {
              success: false,
              error:
                "Necesito la DATABASE_URL de Postgres en el archivo .env para ejecutar consultas.",
              failFast: true,
            };
          }

          const rows = await query(sql, params || [], dbUrl);
          return {
            success: true,
            rowCount: rows.length,
            rows,
            sql,
          };
        }

        // ─── TEST CONNECTION ────────────────────────────────────────────
        case "test_connection": {
          if (!dbUrl) {
            return {
              success: false,
              error:
                "Necesito la DATABASE_URL de Postgres en el archivo .env.",
              failFast: true,
            };
          }

          const result = await query(PING_QUERY, [], dbUrl);
          return {
            success: true,
            alive: result[0]?.alive === 1,
            message: "Conexión a PostgreSQL exitosa. Base de datos lista para explorar.",
          };
        }

        default:
          return {
            success: false,
            error: `Acción desconocida: "${action}". Usa: get_schema, execute, test_connection.`,
          };
      }
    } catch (err) {
      // Fail-fast: errores de conexión se reportan claramente
      const msg = err.message || "";

      if (
        msg.includes("no tiene") ||
        msg.includes("does not exist") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("authentication failed") ||
        msg.includes("password")
      ) {
        return {
          success: false,
          error: `Error de conexión a la base de datos: ${msg}`,
          failFast: true,
          hint: "Verifica que DATABASE_URL en .env sea correcta. Formato: postgresql://user:password@host:5432/dbname",
        };
      }

      // Error de consulta (tabla no existe, etc.)
      return {
        success: false,
        error: `Error ejecutando consulta: ${msg}`,
        sql: action === "execute" ? sql : undefined,
      };
    }
  },
};
