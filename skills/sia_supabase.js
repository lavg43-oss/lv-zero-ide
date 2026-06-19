import { getCredentials } from '../_lib/supabase_env.js';

function resolveCreds() {
  const creds = getCredentials('siae');
  return {
    url: creds.url,
    serviceKey: creds.serviceKey,
    anonKey: creds.anonKey,
  };
}

const handler = async ({ action, sql, table, data, filters, rpc, rpcParams, selectColumns, limit }) => {
  const { url, serviceKey } = resolveCreds();
  if (!url || !serviceKey) {
    return { error: 'SIAE_SUPABASE_URL y SIAE_SUPABASE_SERVICE_ROLE_KEY requeridos en .env_siae' };
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  if (action === 'select') {
    let reqUrl = `${url}/rest/v1/${table}?select=${selectColumns || '*'}`;
    if (limit) reqUrl += `&limit=${limit}`;
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        reqUrl += `&${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`;
      }
    }
    const r = await fetch(reqUrl, { headers: { ...headers, 'Prefer': undefined } });
    return { data: await r.json(), status: r.status };
  }

  if (action === 'rpc') {
    const r = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers, body: JSON.stringify(rpcParams || {})
    });
    const text = await r.text();
    try { return { data: JSON.parse(text), status: r.status }; }
    catch { return { data: text, status: r.status }; }
  }

  if (action === 'sql') {
    // Usa conexión directa vía pooler de Supabase en lugar del RPC exec_sql
    // que no existe en la base de datos SIAE. Esto es más confiable.
    const { getPoolerConfig } = await import('../_lib/supabase_env.js');
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const postgres = require('../tools/pgcli/node_modules/postgres');

    const poolerConfig = getPoolerConfig('siae');
    if (!poolerConfig.ref || !poolerConfig.password) {
      return { error: 'Configuración de pooler incompleta para SIAE. Verifica SIAE_SUPABASE_REF y SIAE_SUPABASE_DB_PASSWORD en .env_siae.', status: 500 };
    }
    const config = {
      host: 'aws-0-us-west-2.pooler.supabase.com',
      // Puerto 6543 = Transaction mode (el pooler de Supabase lo requiere).
      // El DB_URL usa 5432 (session mode), pero el pooler solo acepta
      // conexiones entrantes en 6543 (transaction mode).
      port: 6543,
      database: 'postgres',
      username: `postgres.${poolerConfig.ref}`,
      password: poolerConfig.password,
      ssl: 'require',
      connect_timeout: 10,
      max: 1,
    };
    const client = postgres(config);
    try {
      const result = await client.unsafe(sql);
      await client.end();
      return { data: result, status: 200 };
    } catch(e) {
      await client.end().catch(() => {});
      return { error: e.message, status: 500 };
    }
  }

  if (action === 'call_rpc_raw') {
    const r = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers, body: JSON.stringify(rpcParams || {})
    });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return text; }
  }

  return { error: 'Acción no soportada. Usa: select, rpc, sql, call_rpc_raw' };
};

export default {
  name: 'sia_supabase',
  description: 'BD SIAE exclusiva',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['select', 'rpc', 'sql', 'call_rpc_raw'],
        description: 'Acción a ejecutar'
      },
      table: {
        type: 'string',
        description: 'Nombre de la tabla (requerido para action=select)'
      },
      rpc: {
        type: 'string',
        description: 'Nombre del procedimiento RPC (requerido para action=rpc o call_rpc_raw)'
      },
      rpcParams: {
        type: 'object',
        description: 'Parámetros para el RPC (objeto clave-valor)'
      },
      sql: {
        type: 'string',
        description: 'Consulta SQL (requerido para action=sql)'
      },
      selectColumns: {
        type: 'string',
        description: 'Columnas a seleccionar (opcional, default: *)'
      },
      filters: {
        type: 'object',
        description: 'Filtros como objeto clave-valor (opcional)'
      },
      limit: {
        type: 'number',
        description: 'Límite de registros (opcional)'
      },
      data: {
        type: 'object',
        description: 'Datos para insert/update (opcional)'
      }
    },
    required: ['action']
  },
  handler
};
