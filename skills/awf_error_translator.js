/**
 * AWF Error Translator — Human-friendly error translation
 * Converts Antigravity awf-error-translator to LV-ZERO native
 * 
 * Actions: translate (explain an error), list (show all error patterns)
 */

// ─── Error Translation Database ───────────────────────────────
const DB = [
  // Database
  { pattern: /ECONNREFUSED/i, human: 'La base de datos no está corriendo', action: 'Inicia PostgreSQL/MySQL o verifica que el servicio esté activo', category: 'database' },
  { pattern: /ETIMEDOUT/i, human: 'La base de datos tardó mucho en responder', action: 'Revisa tu conexión de internet o el estado del servidor', category: 'database' },
  { pattern: /ER_ACCESS_DENIED|password authentication failed/i, human: 'Contraseña de base de datos incorrecta', action: 'Revisa las credenciales en tu archivo .env', category: 'database' },
  { pattern: /relation.*does not exist/i, human: 'Esa tabla no existe en la base de datos', action: 'Ejecuta la migración correspondiente o crea la tabla', category: 'database' },
  { pattern: /duplicate key|unique constraint/i, human: 'Ya existe un registro con ese mismo identificador', action: 'Verifica que no estés duplicando datos únicos (ID, email, CURP)', category: 'database' },
  { pattern: /23505/i, human: 'Violación de unicidad en la BD', action: 'El registro que intentas crear ya existe', category: 'database' },

  // JS/TS
  { pattern: /TypeError: Cannot read propert/i, human: 'Estás intentando leer una propiedad que no existe', action: 'Verifica que el objeto no sea null/undefined antes de acceder', category: 'javascript' },
  { pattern: /ReferenceError/i, human: 'Estás usando una variable o función que no has declarado', action: 'Revisa el nombre de la variable, puede tener un typo', category: 'javascript' },
  { pattern: /SyntaxError/i, human: 'Hay un error de sintaxis en el código', action: 'Revisa paréntesis, llaves, comas y puntos y coma', category: 'javascript' },
  { pattern: /Maximum call stack/i, human: 'Hay un bucle infinito o recursión sin fin', action: 'Revisa las condiciones de salida de tus bucles o funciones recursivas', category: 'javascript' },
  { pattern: /Cannot find module/i, human: 'Falta instalar una dependencia', action: 'Ejecuta npm install para instalar los paquetes faltantes', category: 'javascript' },

  // Network
  { pattern: /fetch failed|ECONNREFUSED.*http/i, human: 'No se pudo conectar al servidor', action: 'Verifica que la URL sea correcta y que tengas internet', category: 'network' },
  { pattern: /CORS|cross.origin/i, human: 'El servidor está bloqueando la petición (CORS)', action: 'Configura CORS en el servidor o usa un proxy', category: 'network' },
  { pattern: /ERR_CERT|SSL|certificate/i, human: 'Hay un problema con el certificado SSL', action: 'En desarrollo, usa HTTP. En producción, renueva el certificado', category: 'network' },
  { pattern: /ENOTFOUND|getaddrinfo/i, human: 'El dominio o dirección no existe', action: 'Revisa que la URL esté bien escrita', category: 'network' },
  { pattern: /ECONNRESET/i, human: 'El servidor cerró la conexión inesperadamente', action: 'El servidor puede estar caído o rechazando conexiones', category: 'network' },

  // Package/NPM
  { pattern: /npm ERR!/i, human: 'Error al instalar paquetes', action: 'Borra node_modules y package-lock.json, luego npm install de nuevo', category: 'npm' },
  { pattern: /EACCES|permission denied/i, human: 'No tienes permisos para esta operación', action: 'Ejecuta el comando como administrador o revisa los permisos del archivo', category: 'npm' },
  { pattern: /ENOSPC/i, human: 'El disco está lleno', action: 'Libera espacio en disco', category: 'npm' },
  { pattern: /gyp ERR!/i, human: 'Error compilando un módulo nativo', action: 'Instala las herramientas de build: npm install -g windows-build-tools', category: 'npm' },
  { pattern: /peer dep/i, human: 'Hay conflicto entre versiones de paquetes', action: 'Actualiza las dependencias en package.json a versiones compatibles', category: 'npm' },

  // Build
  { pattern: /Build failed/i, human: 'El build falló', action: 'Revisa el log completo para ver la causa específica', category: 'build' },
  { pattern: /Out of memory|JavaScript heap/i, human: 'El proceso se quedó sin memoria RAM', action: 'Aumenta el límite: NODE_OPTIONS=--max-old-space-size=4096', category: 'build' },
  { pattern: /FATAL ERROR/i, human: 'Error grave del sistema', action: 'Reinicia el proceso. Si persiste, reinstala dependencias', category: 'build' },

  // Git
  { pattern: /CONFLICT|merge conflict/i, human: 'Hay un conflicto entre versiones del código', action: 'Resuelve el conflicto manualmente en los archivos marcados', category: 'git' },
  { pattern: /rejected.*push/i, human: 'El push fue rechazado', action: 'Haz git pull primero para traer los cambios remotos', category: 'git' },
  { pattern: /detached HEAD/i, human: 'No estás en ninguna rama', action: 'Haz git checkout a una rama: git checkout main', category: 'git' },
  { pattern: /not a git repo/i, human: 'Este directorio no es un repositorio git', action: 'Inicia git: git init', category: 'git' },

  // Deploy
  { pattern: /502 Bad Gateway/i, human: 'El servidor no está respondiendo', action: 'Reinicia el servidor o espera a que se recupere', category: 'deploy' },
  { pattern: /503 Service/i, human: 'El servidor está sobrecargado', action: 'Espera unos minutos o escala los recursos', category: 'deploy' },
  { pattern: /quota exceeded|429|rate.limit/i, human: 'Llegaste al límite de uso de la API', action: 'Espera a que se reinicie el contador o actualiza tu plan', category: 'deploy' },
  { pattern: /token.*invalid|unauthorized|401/i, human: 'El token de acceso no es válido o expiró', action: 'Revisa tus API keys en el archivo .env', category: 'deploy' },

  // YAML / Config
  { pattern: /YAMLParseError|YAMLException|BAD_SCALAR/i, human: 'Hay un error de formato en un archivo YAML', action: 'Revisa la indentación y caracteres especiales. Usa comillas para valores con % o :', category: 'config' },
  { pattern: /DUPLICATE_KEY/i, human: 'Hay una clave duplicada en un archivo de configuración', action: 'Busca y elimina la clave repetida en el archivo YAML/JSON', category: 'config' },
  { pattern: /ENOENT.*open/i, human: 'No se encontró el archivo', action: 'Verifica que la ruta del archivo sea correcta', category: 'config' },
];

// ─── Translate ────────────────────────────────────────────────
function translate(errorMessage) {
  if (!errorMessage) return { human: 'No se proporcionó mensaje de error', action: 'Proporciona el texto completo del error', category: 'unknown' };
  
  // Find matching pattern
  const match = DB.find(entry => entry.pattern.test(errorMessage));
  
  if (match) {
    return {
      human: match.human,
      action: match.action,
      category: match.category,
      original: errorMessage.length > 200 ? errorMessage.slice(0, 200) + '...' : errorMessage
    };
  }
  
  // Fallback
  return {
    human: 'Ocurrió un error técnico',
    action: 'Ejecuta /debug para que analice el error a detalle',
    category: 'unknown',
    original: errorMessage.length > 200 ? errorMessage.slice(0, 200) + '...' : errorMessage
  };
}

function listCategories() {
  const cats = {};
  DB.forEach(e => {
    if (!cats[e.category]) cats[e.category] = [];
    cats[e.category].push({ pattern: e.pattern.toString(), human: e.human });
  });
  return cats;
}

// ─── Main Handler ─────────────────────────────────────────────
export default {
  name: 'awf_error_translator',
  description: 'Traduce errores técnicos a lenguaje humano. Detecta patrones de error y sugiere soluciones. 35+ patrones cubriendo database, JS/TS, network, npm, git, deploy, config.',
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['translate', 'list'],
        description: 'translate (explicar un error), list (mostrar categorías de errores)'
      },
      error: {
        type: 'string',
        description: 'El mensaje de error a traducir (requerido para action=translate)'
      }
    },
    required: ['action']
  },

  async handler({ action, error }) {
    switch (action) {
      case 'translate': {
        if (!error) return { error: 'Se requiere el parámetro "error" con el mensaje a traducir' };
        const result = translate(error);
        return {
          translated: true,
          ...result,
          formatted: `❌ ${result.human}\n💡 ${result.action}`
        };
      }
      
      case 'list':
        return { categories: listCategories(), totalPatterns: DB.length };
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
};
