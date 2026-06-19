/**
 * template_engine — SKILL.md Template Compilation
 *
 * Phase 1: Skill-as-Markdown Pattern (gstack-inspired)
 *
 * Compiles SKILL.md.tmpl template files into SKILL.md files.
 * Supports:
 *   - {{variable}} substitution with runtime context
 *   - {{#if variable}}...{{/if}} conditional blocks
 *   - {{#each list}}...{{/each}} iteration blocks
 *   - Nested variable paths ({{nested.key}})
 *   - Partial includes ({{> partialName}})
 *
 * gstack compatibility:
 *   Skills are auto-generated from .tmpl templates.
 *   The template system allows skill maintainers to update
 *   shared preambles, ethos sections, and boilerplate across
 *   all skills by editing a single template.
 *
 * @module template_engine
 */

import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════════
// Template Context
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default context variables available to all templates.
 * These can be overridden by caller-provided context.
 *
 * @returns {object}
 */
function getDefaultContext() {
  return {
    // System info
    year: new Date().getFullYear(),
    date: new Date().toISOString().split("T")[0],
    timestamp: new Date().toISOString(),

    // lv-zero info
    platform: process.platform,
    nodeVersion: process.version,

    // Ethos / philosophy (can be overridden by ETHOS.md)
    ethos: {
      searchBeforeBuilding: true,
      failFast: true,
      userSovereignty: true,
      progressiveEnhancement: true,
    },

    // Empty defaults
    triggers: [],
    allowedTools: [],
    preambleTier: 4,
    version: "1.0.0",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Template Parser
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves a variable path from context.
 * Supports dot notation: "nested.key"
 *
 * @param {string} path - Variable path (e.g., "ethos.searchBeforeBuilding")
 * @param {object} context - Context object
 * @returns {*} Resolved value or undefined
 */
function resolvePath(path, context) {
  const keys = path.split(".");
  let value = context;
  for (const key of keys) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * Compiles a template string with the given context.
 *
 * Supported syntax:
 *   {{variable}}              — Simple variable substitution
 *   {{variable|default}}      — Variable with default value
 *   {{#if variable}}...{{/if}} — Conditional block
 *   {{#unless variable}}...{{/unless}} — Inverse conditional
 *   {{#each list}}...{{/each}} — Iteration (uses {{this}} for current item)
 *   {{> partialName}}         — Include partial from templates/ directory
 *
 * @param {string} template - Template content
 * @param {object} context - Variables to substitute
 * @param {object} [options]
 * @param {string} [options.templateDir] - Directory for partial resolution
 * @returns {string} Compiled output
 */
function compile(template, context, options = {}) {
  const ctx = { ...getDefaultContext(), ...context };
  let output = template;

  // 1. Process partial includes: {{> partialName}}
  if (options.templateDir) {
    output = output.replace(/\{\{>\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, partialName) => {
      const partialPath = path.resolve(options.templateDir, `${partialName}.md`);
      try {
        if (fs.existsSync(partialPath)) {
          const partialContent = fs.readFileSync(partialPath, "utf-8");
          // Recursively compile the partial with the same context
          return compile(partialContent, ctx, options);
        }
      } catch {
        // Partial not found — leave as-is
      }
      return match;
    });
  }

  // 2. Process each blocks: {{#each list}}...{{/each}}
  const eachRegex = /\{\{#each\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  output = output.replace(eachRegex, (match, listPath, block) => {
    const list = resolvePath(listPath, ctx);
    if (!Array.isArray(list) || list.length === 0) return "";

    return list
      .map((item) => {
        // Create a context where {{this}} refers to the current item
        const itemCtx = { ...ctx, this: item };
        // Also flatten item properties into context
        if (typeof item === "object" && item !== null) {
          Object.assign(itemCtx, item);
        }
        return compile(block, itemCtx, options);
      })
      .join("\n");
  });

  // 3. Process if blocks: {{#if variable}}...{{/if}}
  const ifRegex = /\{\{#if\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;
  output = output.replace(ifRegex, (match, varPath, block) => {
    const value = resolvePath(varPath, ctx);
    if (value && value !== "false" && value !== "0" && value !== 0) {
      return compile(block, ctx, options);
    }
    return "";
  });

  // 4. Process unless blocks: {{#unless variable}}...{{/unless}}
  const unlessRegex = /\{\{#unless\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g;
  output = output.replace(unlessRegex, (match, varPath, block) => {
    const value = resolvePath(varPath, ctx);
    if (!value || value === "false" || value === "0" || value === 0) {
      return compile(block, ctx, options);
    }
    return "";
  });

  // 5. Process simple variables: {{variable}} and {{variable|default}}
  const varRegex = /\{\{([a-zA-Z0-9_.]+)(?:\|([^}]*))?\}\}/g;
  output = output.replace(varRegex, (match, varPath, defaultValue) => {
    const value = resolvePath(varPath, ctx);
    if (value !== null && value !== undefined) {
      return String(value);
    }
    return defaultValue !== undefined ? defaultValue : match;
  });

  return output;
}

// ═══════════════════════════════════════════════════════════════════════════════
// File-Based Compilation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compiles a SKILL.md.tmpl file into a SKILL.md file.
 *
 * @param {string} tmplPath - Path to the .tmpl file
 * @param {object} context - Variables for substitution
 * @param {object} [options]
 * @param {boolean} [options.write=true] - Write the output to SKILL.md
 * @returns {Promise<{ success: boolean, output: string, outputPath?: string }>}
 */
export async function compileTemplate(tmplPath, context, options = {}) {
  const { write = true } = options;

  try {
    if (!fs.existsSync(tmplPath)) {
      return { success: false, error: `Template not found: ${tmplPath}`, output: "" };
    }

    const template = fs.readFileSync(tmplPath, "utf-8");
    const templateDir = path.dirname(tmplPath);

    const output = compile(template, context, { templateDir });

    if (write) {
      // Write to SKILL.md in the same directory
      const outputPath = path.resolve(templateDir, "SKILL.md");
      fs.writeFileSync(outputPath, output, "utf-8");
      return { success: true, output, outputPath };
    }

    return { success: true, output };
  } catch (err) {
    return { success: false, error: err.message, output: "" };
  }
}

/**
 * Compiles all .tmpl files in a directory tree.
 * Scans recursively for SKILL.md.tmpl files.
 *
 * @param {string} baseDir - Base directory to scan
 * @param {object} context - Variables for substitution
 * @param {object} [options]
 * @param {boolean} [options.overwrite=false] - Overwrite existing SKILL.md files
 * @returns {Promise<{ compiled: number, skipped: number, errors: string[] }>}
 */
export async function compileAllTemplates(baseDir, context, options = {}) {
  const { overwrite = false } = options;
  let compiled = 0;
  let skipped = 0;
  const errors = [];

  if (!fs.existsSync(baseDir)) {
    return { compiled: 0, skipped: 0, errors: [`Directory not found: ${baseDir}`] };
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const skillDir = path.resolve(baseDir, entry.name);
    const tmplPath = path.resolve(skillDir, "SKILL.md.tmpl");
    const mdPath = path.resolve(skillDir, "SKILL.md");

    if (!fs.existsSync(tmplPath)) continue;

    // Skip if SKILL.md already exists and overwrite is false
    if (fs.existsSync(mdPath) && !overwrite) {
      skipped++;
      continue;
    }

    const result = await compileTemplate(tmplPath, context);
    if (result.success) {
      compiled++;
    } else {
      errors.push(`${entry.name}: ${result.error}`);
    }
  }

  return { compiled, skipped, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export {
  compile,
  getDefaultContext,
  resolvePath,
};
