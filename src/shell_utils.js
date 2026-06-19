/**
 * lv-zero — Shell Utilities
 *
 * v1.0
 *   Utilidades para manejar rutas con espacios en comandos shell.
 *   Previene errores cuando rutas como "C:\My Documents\file.js"
 *   se pasan sin comillas a spawn()/exec().
 *
 * Uso:
 *   import { quotePath, toNodePath } from "./shell_utils.js";
 *
 *   // CMD: wrap paths with spaces in double quotes
 *   const cmd = quotePath('git add C:\\My Documents\\file.js', 'cmd');
 *   // → git add "C:\My Documents\file.js"
 *
 *   // PowerShell: wrap paths with spaces in single quotes (prevents $var)
 *   const cmd2 = quotePath('git add C:\\My Documents\\$file.js', 'powershell');
 *   // → git add 'C:\My Documents\$file.js'
 *
 *   // Forward slashes avoid quoting entirely
 *   const safe = toNodePath('C:\\My Documents\\file.js');
 *   // → C:/My Documents/file.js
 */

/**
 * Detecta tokens que parecen rutas de archivo con espacios y los envuelve
 * en comillas apropiadas según el shell.
 *
 * @param {string} command - Comando completo (ej: "git add C:\My Docs\file.js")
 * @param {string} shellType - "cmd" o "powershell"
 * @returns {string} Comando con rutas con espacios entrecomilladas
 */
export function quotePath(command, shellType) {
  if (!command || typeof command !== "string") return command;

  // Si no hay espacios, no hay necesidad de entrecomillar
  if (!command.includes(" ")) return command;

  // Dividir en tokens respetando comillas existentes
  // Captura: palabras sin espacios, o strings entrecomillados
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

  const result = tokens.map((token) => {
    // Saltar tokens ya entrecomillados (no duplicar comillas)
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token;
    }

    // Detectar si el token parece una ruta con espacios
    // Criterio: contiene espacios Y (contiene \ o / o empieza con letra:\)
    const hasSpaces = token.includes(" ");
    if (!hasSpaces) return token;

    const looksLikePath =
      token.includes("\\") ||
      token.includes("/") ||
      /^[A-Za-z]:\\/.test(token) ||
      /^[A-Za-z]:\//.test(token) ||
      // También detectar argumentos tipo --path=... o --file=...
      /^--[\w-]+=/.test(token);

    if (looksLikePath) {
      // Manejar argumentos con formato --name=value
      const eqIdx = token.indexOf("=");
      if (eqIdx > 0 && token.startsWith("--")) {
        const flag = token.slice(0, eqIdx + 1);
        const value = token.slice(eqIdx + 1);
        if (shellType === "powershell") {
          return `${flag}'${value}'`;
        }
        return `${flag}"${value}"`;
      }

      if (shellType === "powershell") {
        // PowerShell: single quotes evitan expansión de $variable
        return `'${token}'`;
      }
      // CMD: double quotes
      return `"${token}"`;
    }
    

    return token;
  });

  return result.join(" ");
}

/**
 * Convierte backslashes de Windows en forward slashes.
 * Los forward slashes funcionan en CMD y PowerShell cuando se pasan
 * a través de Node.js child_process, y evitan tener que entrecomillar.
 *
 * @param {string} windowsPath - Ruta con backslashes
 * @returns {string} Ruta con forward slashes
 */
export function toNodePath(windowsPath) {
  if (!windowsPath || typeof windowsPath !== "string") return windowsPath;
  return windowsPath.replace(/\\/g, "/");
}
