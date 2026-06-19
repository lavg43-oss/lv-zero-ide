import { createClient } from '@supabase/supabase-js';
import { getCredentials, getPoolerConfig } from '../_lib/supabase_env.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// ─── Resolve __dirname equivalent for ESM ──────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dotenv is already loaded by the orchestrator at startup (init() → loadEnv())

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const creds = getCredentials('siae');
    if (!creds.url || !creds.serviceKey) {
      throw new Error('SIAE_SUPABASE_URL y SIAE_SUPABASE_SERVICE_ROLE_KEY requeridos en .env o .env_siae');
    }
    supabase = createClient(creds.url, creds.serviceKey, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

// ─── Helper: ejecutar SQL directo vía pooler (reemplaza RPC exec_sql) ──────
const _require = createRequire(import.meta.url);
const _postgres = _require('../tools/pgcli/node_modules/postgres');

async function execSQL(sql) {
  const poolerConfig = getPoolerConfig('siae');
  if (!poolerConfig.ref || !poolerConfig.password) {
    throw new Error('Configuración de pooler incompleta para SIAE');
  }
  const config = {
    host: 'aws-0-us-west-2.pooler.supabase.com',
    port: 6543,  // Transaction mode
    database: 'postgres',
    username: `postgres.${poolerConfig.ref}`,
    password: poolerConfig.password,
    ssl: 'require',
    connect_timeout: 10,
    max: 1,
  };
  const client = _postgres(config);
  try {
    const result = await client.unsafe(sql);
    await client.end();
    return result;
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
}

// ─── Helper: referencia a sí misma para llamadas recursivas ────────────────
// En ESM no tenemos module.exports, usamos esta referencia
const skill = {
  name: 'siae_consolidator',
  description: 'Analiza SIAE: consulta alumnos, asistencias, incidencias, alertas. Crea reportes consolidados.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list_tables', 
          'discover_schema', 
          'analyze_attendance', 
          'create_alerts_table',
          'generate_report',
          'full_pipeline'
        ],
        description: 'Acción a ejecutar'
      },
      month: {
        type: 'string',
        description: 'Mes para filtrar (ej: "2026-04")'
      }
    },
    required: ['action']
  },
  handler: async ({ action, month }) => {
    const sb = getSupabase();
    const defaultMonth = '2026-04';

    switch (action) {
      case 'list_tables': {
        try {
          const data = await execSQL(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
          return { success: true, tables: data };
        } catch (error) {
          try {
            const { data: d2 } = await sb.from('_tables').select('*').limit(100);
            return { success: false, error: error.message, fallback: d2 };
          } catch {
            return { success: false, error: error.message };
          }
        }
      }

      case 'discover_schema': {
        try {
          const data = await execSQL(`
            SELECT
              t.table_name,
              json_agg(
                json_build_object(
                  'column_name', c.column_name,
                  'data_type', c.data_type,
                  'is_nullable', c.is_nullable
                ) ORDER BY c.ordinal_position
              ) as columns
            FROM information_schema.tables t
            JOIN information_schema.columns c ON t.table_name = c.table_name
            WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            GROUP BY t.table_name
            ORDER BY t.table_name
          `);
          return { success: true, schema: data };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }

      case 'create_alerts_table': {
        try {
          await execSQL(`
            CREATE TABLE IF NOT EXISTS public.alertas_administrativas (
              id BIGSERIAL PRIMARY KEY,
              alumno_id VARCHAR(100) NOT NULL,
              nombre_alumno VARCHAR(255),
              curso VARCHAR(100),
              total_faltas INT DEFAULT 0,
              total_incidencias INT DEFAULT 0,
              mes_referencia VARCHAR(7) NOT NULL,
              nivel_alerta VARCHAR(20) DEFAULT 'media',
              requiere_atencion BOOLEAN DEFAULT false,
              fecha_generacion TIMESTAMPTZ DEFAULT NOW(),
              expediente_resumen TEXT,
              notas TEXT
            );
            
            CREATE INDEX IF NOT EXISTS idx_alertas_mes ON alertas_administrativas(mes_referencia);
            CREATE INDEX IF NOT EXISTS idx_alertas_alumno ON alertas_administrativas(alumno_id);
          `);
          return { success: true, message: 'Tabla alertas_administrativas creada/verificada' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }

      case 'analyze_attendance': {
        const targetMonth = month || defaultMonth;
        
        const schemaResult = await skill.handler({ action: 'discover_schema' });
        if (!schemaResult.success) {
          return schemaResult;
        }

        const tables = schemaResult.schema;
        const alumnosTables = tables.filter(t => 
          /alumno|estudiante|student|alumni/i.test(t.table_name)
        );
        const asistenciaTables = tables.filter(t => 
          /asistencia|attendance|falta|present/i.test(t.table_name)
        );
        const incidenciaTables = tables.filter(t => 
          /incidencia|incident|falta_disciplina|sancion/i.test(t.table_name)
        );
        const expedienteTables = tables.filter(t => 
          /expediente|record|expedient/i.test(t.table_name)
        );

        return {
          success: true,
          month: targetMonth,
          tables_found: {
            alumnos: alumnosTables,
            asistencias: asistenciaTables,
            incidencias: incidenciaTables,
            expedientes: expedienteTables,
            all: tables.map(t => t.table_name)
          },
          message: 'Se requiere invocar acciones específicas según las tablas encontradas'
        };
      }

      case 'full_pipeline': {
        const targetMonth = month || defaultMonth;
        
        const createResult = await skill.handler({ action: 'create_alerts_table' });
        if (!createResult.success) return createResult;

        const schemaResult = await skill.handler({ action: 'discover_schema' });
        if (!schemaResult.success) return schemaResult;

        const tables = schemaResult.schema;
        const allTableNames = tables.map(t => t.table_name);

        const alumnoTable = allTableNames.find(t => /^alumno/i.test(t)) || 
                            allTableNames.find(t => /alumno|estudiante/i.test(t));
        const asistenciaTable = allTableNames.find(t => /asistenci/i.test(t));
        const incidenciaTable = allTableNames.find(t => /incidencia/i.test(t));
        const expedienteTable = allTableNames.find(t => /expediente/i.test(t));
        const faltaTable = allTableNames.find(t => /falta/i.test(t));
        const matriculaTable = allTableNames.find(t => /matricula/i.test(t));

        return {
          success: true,
          month: targetMonth,
          tables: {
            alumnos: alumnoTable,
            asistencias: asistenciaTable,
            incidencias: incidenciaTable,
            expedientes: expedienteTable,
            faltas: faltaTable,
            matriculas: matriculaTable,
            all: allTableNames
          },
          message: 'Esquema descubierto. Ahora puedo consultar datos específicos.'
        };
      }

      case 'generate_report': {
        return { success: true, message: 'Usar desde el flujo principal del agente' };
      }

      default:
        return { success: false, error: `Acción desconocida: ${action}` };
    }
  }
};

export default skill;
