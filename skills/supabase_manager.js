/**
 * supabase_manager — Skill de Base de Datos (Supabase)
 *
 * Permite al agente Select, Insert y Update en tablas de Supabase.
 * Usa SUPABASE_URL y SUPABASE_KEY del entorno.
 */
export default {
  name: "supabase_manager",
  description:
    "Cliente Supabase para tu PROYECTO. Usa SUPABASE_URL/KEY del .env. " +
    "Para otra BD, pasa url y key explícitamente. NUNCA uses LV_SUPABASE_* — esas son del sistema.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["select", "insert", "update"],
        description:
          "Operación a ejecutar:\n" +
          '- "select": Obtiene registros de una tabla. Usa "filters" para condiciones WHERE.\n' +
          '- "insert": Inserta uno o más registros. Requiere "data" como array de objetos.\n' +
          '- "update": Actualiza registros existentes. Requiere "data" y "filters".',
      },
      table: {
        type: "string",
        description:
          'Nombre de la tabla en Supabase. Ejemplo: "conversaciones", "usuarios", "logs".',
      },
      data: {
        type: "object",
        description:
          'Datos para insertar o actualizar. Para "insert": un objeto con columnas y valores. ' +
          'Para "update": un objeto con las columnas a modificar.',
      },
      filters: {
        type: "object",
        description:
          'Filtros para la consulta (WHERE). Ejemplo: { "id": 123, "activo": true }. ' +
          "Para select, limita los resultados. Para update, determina qué registros modificar.",
      },
      selectColumns: {
        type: "string",
        description:
          'Columnas a retornar en SELECT, separadas por coma. Por defecto: "*" (todas).',
      },
      limit: {
        type: "number",
        description:
          "Número máximo de registros a retornar en SELECT. Por defecto: 10.",
        default: 10,
      },
      orderBy: {
        type: "object",
        description:
          'Ordenamiento de resultados. Ejemplo: { "column": "created_at", "ascending": false }.',
        properties: {
          column: { type: "string" },
          ascending: { type: "boolean" },
        },
      },
      url: {
        type: "string",
        description: "Opcional: URL de Supabase. Si no se proporciona, usa SUPABASE_URL del .env.",
      },
      service_role_key: {
        type: "string",
        description: "Opcional: Service role key para operaciones admin. Si no se proporciona, usa SUPABASE_SERVICE_ROLE_KEY del .env.",
      },
      anon_key: {
        type: "string",
        description: "Opcional: Anon key. Si no se proporciona, usa SUPABASE_KEY del .env.",
      },
    },
    required: ["action", "table"],
  },

  handler: async ({ action, table, data, filters, selectColumns, limit, orderBy, url: explicitUrl, service_role_key: explicitKey, anon_key: explicitAnon }) => {
    // Project skills use SUPABASE_* by default. Pass explicit url/key to override.
    const url = explicitUrl || process.env.SUPABASE_URL;
    const key = explicitKey || explicitAnon || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

    if (!url || !key) {
      return {
        success: false,
        error:
          "SUPABASE_URL o SUPABASE_KEY no configuradas para el proyecto. " +
          "Agrega ambas en el archivo .env o pasa url y key explícitamente.",
      };
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, key);

      switch (action) {
        case "select":
          return await handleSelect(supabase, table, filters, selectColumns, limit, orderBy);
        case "insert":
          return await handleInsert(supabase, table, data);
        case "update":
          return await handleUpdate(supabase, table, data, filters);
        default:
          return {
            success: false,
            error: `Acción desconocida: "${action}". Usa: select, insert, update.`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: `Error en operación Supabase: ${err.message}`,
      };
    }
  },
};

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleSelect(supabase, table, filters, selectColumns, limit, orderBy) {
  let query = supabase
    .from(table)
    .select(selectColumns || "*", { count: "exact" });

  // Apply filters (simple equality)
  if (filters && typeof filters === "object") {
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }
  }

  // Apply ordering
  if (orderBy && orderBy.column) {
    query = query.order(orderBy.column, {
      ascending: orderBy.ascending !== false,
    });
  }

  // Apply limit
  query = query.limit(limit || 10);

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    success: true,
    action: "select",
    table,
    total: count || data?.length || 0,
    records: data || [],
  };
}

async function handleInsert(supabase, table, data) {
  if (!data) {
    return {
      success: false,
      error: 'Se requiere "data" para la acción "insert". Proporciona un objeto con los valores.',
    };
  }

  const { data: inserted, error } = await supabase
    .from(table)
    .insert(data)
    .select();

  if (error) throw error;

  return {
    success: true,
    action: "insert",
    table,
    records: inserted || [],
    message: `Insertado ${inserted?.length || 1} registro(s) en "${table}".`,
  };
}

async function handleUpdate(supabase, table, data, filters) {
  if (!data) {
    return {
      success: false,
      error: 'Se requiere "data" para la acción "update". Proporciona un objeto con los valores a actualizar.',
    };
  }

  if (!filters || Object.keys(filters).length === 0) {
    return {
      success: false,
      error: 'Se requiere "filters" para la acción "update". Usa filtros para identificar los registros a modificar.',
    };
  }

  let query = supabase.from(table).update(data);

  // Apply filters
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  const { data: updated, error } = await query.select();

  if (error) throw error;

  return {
    success: true,
    action: "update",
    table,
    records: updated || [],
    message: `Actualizado(s) ${updated?.length || 0} registro(s) en "${table}".`,
  };
}
