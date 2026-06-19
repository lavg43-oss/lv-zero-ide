import { getPoolerConfig } from '../_lib/supabase_env.js';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const postgres = _require('../tools/pgcli/node_modules/postgres');

const POOLER_HOSTS = {
  siae: 'aws-0-us-west-2.pooler.supabase.com',
  lvzero: 'aws-1-us-east-1.pooler.supabase.com',
};

export default {
  name: 'pg_query',
  description: 'Ejecuta consultas SQL directas contra las bases de datos configuradas (SIAE o LV-ZERO). Usa el pooler de Supabase vía el paquete postgres de npm.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', enum: ['siae', 'lvzero'], description: 'Proyecto: "siae" para BD SIAE, "lvzero" para BD LV-ZERO' },
      sql: { type: 'string', description: 'Consulta SQL a ejecutar' }
    },
    required: ['project', 'sql']
  },
  async handler({ project, sql }) {
    const poolerConfig = getPoolerConfig(project);
    const host = POOLER_HOSTS[project];
    if (!host || !poolerConfig.ref || !poolerConfig.password) {
      const prefix = project === 'siae' ? 'SIAE_SUPABASE_' : 'LV_SUPABASE_';
      throw new Error(`Configuración de pooler incompleta para "${project}". Se requiere ${prefix}REF y ${prefix}DB_PASSWORD en .env o .env_siae.`);
    }
    const config = {
      host,
      // Puerto 6543 = Transaction mode (el pooler de Supabase lo requiere).
      // El pooler de Supabase tiene 2 puertos:
      //   6543 → Transaction mode (conexiones se reúsan por transacción) ✅ Funciona
      //   5432 → Session mode (cada conexión = una conexión a la BD) ❌ Timeout
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
      return {
        success: true,
        project,
        sql,
        rows: Array.isArray(result) ? result : [],
        rowCount: Array.isArray(result) ? result.length : null,
        raw: result
      };
    } catch(e) {
      await client.end().catch(() => {});
      return { success: false, project, sql, error: e.message };
    }
  }
};
