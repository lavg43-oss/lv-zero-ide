/**
 * skill_md_loader — Markdown Skill Loader
 *
 * Phase 1: Skill-as-Markdown Pattern (gstack-inspired)
 *
 * Loads skills defined as SKILL.md files with YAML frontmatter.
 * Supports:
 *   - YAML frontmatter (name, description, triggers, allowed-tools, version)
 *   - Template compilation from SKILL.md.tmpl files
 *   - Trigger phrase matching for proactive skill suggestions
 *   - Allowed-tools filtering per skill
 *   - Directory-based organization (skills/<name>/SKILL.md)
 *
 * gstack compatibility:
 *   Every skill is a SKILL.md with YAML frontmatter + Markdown body.
 *   The frontmatter declares allowed tools, trigger phrases, and version.
 *   Skills can be auto-generated from .tmpl templates.
 *
 * @module skill_md_loader
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.resolve(__dirname, "..");

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} SkillMdDefinition
 * @property {string} name - Unique skill name
 * @property {string} description - Human-readable description
 * @property {string} content - Full Markdown body (after frontmatter)
 * @property {string[]} [triggers] - Natural language trigger phrases
 * @property {string[]} [allowedTools] - Tool names this skill can use
 * @property {string} [version] - Skill version
 * @property {string} [preambleTier] - Preamble injection tier (gstack compat)
 * @property {string} skillPath - Path to the skill directory
 * @property {string} mdPath - Path to the SKILL.md file
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Frontmatter Parsing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parses YAML frontmatter from a Markdown file.
 * Supports the gstack SKILL.md format:
 *   ---
 *   name: review
 *   description: Pre-landing PR review.
 *   version: 1.0.0
 *   allowed-tools:
 *     - Bash, Read, Edit, Write
 *   triggers:
 *     - review this pr
 *     - code review
 *   ---
 *
 * @param {string} content - Raw file content
 * @returns {{ frontmatter: object, body: string, hasFrontmatter: boolean }}
 */
function parseFrontmatter(content) {
  const result = {
    frontmatter: {},
    body: content,
    hasFrontmatter: false,
  };

  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return result;

  result.hasFrontmatter = true;
  result.body = content.slice(match[0].length);

  const raw = match[1];
  const lines = raw.split("\n");
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array item (starts with "- ")
    const arrayMatch = trimmed.match(/^-\s+(.+)/);
    if (arrayMatch && currentKey) {
      if (!Array.isArray(result.frontmatter[currentKey])) {
        result.frontmatter[currentKey] = [];
      }
      result.frontmatter[currentKey].push(arrayMatch[1].trim());
      continue;
    }

    // Key: value
    const kvMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      let value = kvMatch[2].trim();

      // Handle quoted values
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // If value is empty, this might be an array (next lines will have "- ")
      if (value === "" || value === "[]") {
        result.frontmatter[currentKey] = [];
      } else {
        result.frontmatter[currentKey] = value;
      }
    }
  }

  return result;
}

/**
 * Normalizes frontmatter keys from gstack format to lv-zero format.
 *   allowed-tools → allowedTools
 *   preamble-tier → preambleTier
 *
 * @param {object} frontmatter
 * @returns {object}
 */
function normalizeKeys(frontmatter) {
  const normalized = {};
  const KEY_MAP = {
    "allowed-tools": "allowedTools",
    "allowed_tools": "allowedTools",
    "preamble-tier": "preambleTier",
    "preamble_tier": "preambleTier",
  };

  for (const [key, value] of Object.entries(frontmatter)) {
    const mappedKey = KEY_MAP[key] || key;
    normalized[mappedKey] = value;
  }

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Discovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scans a directory for SKILL.md files.
 * Looks in subdirectories: skills/<name>/SKILL.md
 *
 * @param {string} [baseDir=SKILLS_DIR] - Base directory to scan
 * @returns {SkillMdDefinition[]}
 */
function discoverSkills(baseDir = SKILLS_DIR) {
  const skills = [];

  if (!fs.existsSync(baseDir)) return skills;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Skip hidden directories and node_modules
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const skillPath = path.resolve(baseDir, entry.name);
    const mdPath = path.resolve(skillPath, "SKILL.md");

    if (!fs.existsSync(mdPath)) continue;

    try {
      const content = fs.readFileSync(mdPath, "utf-8");
      const { frontmatter: rawFm, body } = parseFrontmatter(content);
      const frontmatter = normalizeKeys(rawFm);

      const name = frontmatter.name || entry.name;
      const description = frontmatter.description || `Skill: ${name}`;
      const triggers = frontmatter.triggers || [];
      const allowedTools = frontmatter.allowedTools || [];
      const version = frontmatter.version || "1.0.0";
      const preambleTier = frontmatter.preambleTier || null;

      skills.push({
        name,
        description,
        content: body.trim(),
        triggers: Array.isArray(triggers) ? triggers : [triggers].filter(Boolean),
        allowedTools: Array.isArray(allowedTools) ? allowedTools : [allowedTools].filter(Boolean),
        version,
        preambleTier,
        skillPath,
        mdPath,
      });
    } catch (err) {
      console.warn(`   ⚠️ [SkillMD] Error reading ${mdPath}: ${err.message}`);
    }
  }

  return skills;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Object Factory
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts a SkillMdDefinition into an lv-zero skill object
 * compatible with the orchestrator's skill format:
 *   { name, description, parameters, handler }
 *
 * The handler injects the Markdown body as context when called.
 *
 * @param {SkillMdDefinition} def
 * @returns {object} lv-zero skill object
 */
function createSkillFromMd(def) {
  return {
    name: def.name,
    description: def.description,

    // Parameters schema — the skill accepts optional context/input
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: `Input or context for the "${def.name}" skill. Optional — the skill prompt provides full instructions.`,
        },
        context: {
          type: "string",
          description: "Additional context from previous steps (e.g., design doc, test results). Optional.",
        },
      },
    },

    /**
     * Handler that returns the Markdown body as the skill's prompt/instructions.
     * The agent receives this content and follows the instructions within.
     *
     * @param {object} args - { input?, context? }
     * @param {object} options - { signal? }
     * @returns {Promise<object>}
     */
    handler: async (args, options = {}) => {
      let result = `# ${def.name}\n\n${def.description}\n\n`;

      // Include the full Markdown body as instructions
      result += `## Instructions\n\n${def.content}\n\n`;

      // Include user input if provided
      if (args.input) {
        result += `## Input\n\n${args.input}\n\n`;
      }

      // Include context if provided
      if (args.context) {
        result += `## Context\n\n${args.context}\n\n`;
      }

      // Include trigger info if available
      if (def.triggers && def.triggers.length > 0) {
        result += `## Triggers\n\nThis skill can be activated by: ${def.triggers.join(", ")}\n`;
      }

      return {
        success: true,
        result,
        skillName: def.name,
        skillVersion: def.version,
      };
    },

    // Metadata for the skill system
    _mdSkill: true,
    _triggers: def.triggers,
    _allowedTools: def.allowedTools,
    _version: def.version,
    _preambleTier: def.preambleTier,
    _skillPath: def.skillPath,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trigger Matching
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Matches user input against skill trigger phrases.
 * Returns skills whose triggers match the input.
 *
 * @param {string} userInput - The user's message
 * @param {Array} skills - Array of skill objects (with _triggers metadata)
 * @returns {Array<{ skill: object, match: string, confidence: number }>}
 */
function matchTriggers(userInput, skills) {
  if (!userInput || !skills || skills.length === 0) return [];

  const input = userInput.toLowerCase();
  const matches = [];

  for (const skill of skills) {
    const triggers = skill._triggers;
    if (!triggers || triggers.length === 0) continue;

    for (const trigger of triggers) {
      const triggerLower = trigger.toLowerCase();
      // Exact phrase match
      if (input.includes(triggerLower)) {
        matches.push({
          skill,
          match: trigger,
          confidence: 1.0,
        });
        break; // One match per skill is enough
      }
      // Partial word match (all words in trigger appear in input)
      const triggerWords = triggerLower.split(/\s+/).filter(Boolean);
      if (triggerWords.length > 1) {
        const wordsPresent = triggerWords.filter((w) => input.includes(w));
        const ratio = wordsPresent.length / triggerWords.length;
        if (ratio >= 0.7) {
          matches.push({
            skill,
            match: trigger,
            confidence: Math.round(ratio * 10) / 10,
          });
          break;
        }
      }
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Loader
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Loads all Markdown-defined skills from the skills directory.
 *
 * @param {object} [options]
 * @param {string} [options.baseDir] - Base directory to scan (default: skills/)
 * @param {boolean} [options.includeAntigravity=true] - Also scan antigravity/ subdirs
 * @returns {Promise<object[]>} Array of lv-zero skill objects
 */
export async function loadMarkdownSkills(options = {}) {
  const { baseDir = SKILLS_DIR, includeAntigravity = true } = options;
  const allSkills = [];

  // 1. Scan main skills/ directory for SKILL.md subdirectories
  const mainSkills = discoverSkills(baseDir);
  for (const def of mainSkills) {
    allSkills.push(createSkillFromMd(def));
  }

  // 2. Optionally scan antigravity/ subdirectory
  if (includeAntigravity) {
    const antigravityDir = path.resolve(baseDir, "antigravity");
    if (fs.existsSync(antigravityDir)) {
      const antigravitySkills = discoverSkills(antigravityDir);
      for (const def of antigravitySkills) {
        // Avoid duplicates — antigravity skills may already be loaded via skill_bridge.js
        if (!allSkills.some((s) => s.name === def.name)) {
          allSkills.push(createSkillFromMd(def));
        }
      }
    }
  }

  return allSkills;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export {
  discoverSkills,
  createSkillFromMd,
  matchTriggers,
  parseFrontmatter,
  normalizeKeys,
};
