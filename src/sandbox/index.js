/**
 * ─── Sandbox Module — Public API ────────────────────────────────────────────
 *
 * Punto de entrada único para el módulo de sandbox.
 *
 * v1.0 — Junio 2026
 *
 * @module sandbox
 */

export { Sandbox } from "./sandbox.js";
export { SecurityPolicy, POLICY_LEVELS, DANGEROUS_PATTERNS } from "./policy.js";

/**
 * Crea una instancia de Sandbox con la configuración por defecto.
 * @param {object} [options]
 * @param {string} [options.policyLevel='sandboxed'] - Nivel de seguridad
 * @param {number} [options.timeout=30000] - Timeout global en ms
 * @returns {Sandbox}
 *
 * @example
 * import { createSandbox } from './sandbox/index.js';
 * const sandbox = createSandbox({ policyLevel: 'restricted' });
 * const result = await sandbox.run('const x = 1 + 1; x;');
 * console.log(result); // { success: true, result: 2 }
 */
export function createSandbox(options = {}) {
  return new (require("./sandbox.js").Sandbox || require("./sandbox.js").default)(options);
}

export default { Sandbox, SecurityPolicy, createSandbox, POLICY_LEVELS };
