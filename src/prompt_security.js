/**
 * prompt_security.js — Prompt Injection Protection Module
 *
 * Protects against prompt injection attacks and sanitizes untrusted content
 * before it reaches the LLM. Zero external dependencies, all functions are
 * synchronous for maximum performance.
 *
 * Exports:
 *   sanitizeUserInput(input)       - Strip injection patterns from user input
 *   sanitizeToolOutput(output)     - Sanitize MCP tool results before LLM injection
 *   detectInjection(text)          - Run text against all known injection patterns
 *   createSecurityMiddleware()     - Returns { preProcess, postProcess } for easy integration
 *   INJECTION_PATTERNS             - Array of pattern definitions
 *
 * @module prompt_security
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Default maximum output length for sanitizeToolOutput (100 KB) */
const DEFAULT_MAX_OUTPUT_LENGTH = 100 * 1024;

/**
 * Severity weights for confidence scoring.
 * @enum {number}
 */
const SEVERITY_WEIGHTS = {
  high: 0.35,
  medium: 0.20,
  low: 0.10,
};

/**
 * Threshold above which confidence is considered a definite injection.
 */
const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Unicode homoglyph mapping — replaces visually similar characters
 * that could be used to bypass pattern matching.
 * Maps confusable characters to their ASCII equivalents.
 */
const HOMOGLYPH_MAP = new Map([
  // Latin confusables
  ["À", "A"], ["Á", "A"], ["Â", "A"], ["Ã", "A"], ["Ä", "A"], ["Å", "A"], ["Ā", "A"],
  ["à", "a"], ["á", "a"], ["â", "a"], ["ã", "a"], ["ä", "a"], ["å", "a"], ["ā", "a"],
  ["È", "E"], ["É", "E"], ["Ê", "E"], ["Ë", "E"], ["Ē", "E"],
  ["è", "e"], ["é", "e"], ["ê", "e"], ["ë", "e"], ["ē", "e"],
  ["Ì", "I"], ["Í", "I"], ["Î", "I"], ["Ï", "I"],
  ["ì", "i"], ["í", "i"], ["î", "i"], ["ï", "i"],
  ["Ò", "O"], ["Ó", "O"], ["Ô", "O"], ["Õ", "O"], ["Ö", "O"], ["Ø", "O"],
  ["ò", "o"], ["ó", "o"], ["ô", "o"], ["õ", "o"], ["ö", "o"], ["ø", "o"],
  ["Ù", "U"], ["Ú", "U"], ["Û", "U"], ["Ü", "U"],
  ["ù", "u"], ["ú", "u"], ["û", "u"], ["ü", "u"],
  ["Ç", "C"], ["ç", "c"],
  ["Ñ", "N"], ["ñ", "n"],
  ["Ý", "Y"], ["ý", "y"],
  // Cyrillic confusables (homoglyphs that look like Latin letters)
  ["А", "A"], ["В", "B"], ["Е", "E"], ["К", "K"], ["М", "M"],
  ["Н", "H"], ["О", "O"], ["Р", "P"], ["С", "C"], ["Т", "T"],
  ["У", "Y"], ["Х", "X"], ["а", "a"], ["е", "e"], ["о", "o"],
  ["р", "p"], ["с", "c"], ["у", "y"], ["х", "x"],
  // Greek confusables
  ["Α", "A"], ["Β", "B"], ["Ε", "E"], ["Ζ", "Z"], ["Η", "H"],
  ["Ι", "I"], ["Κ", "K"], ["Μ", "M"], ["Ν", "N"], ["Ο", "O"],
  ["Ρ", "P"], ["Τ", "T"], ["Υ", "Y"], ["Χ", "X"],
  ["α", "a"], ["β", "b"], ["ε", "e"], ["κ", "k"], ["ο", "o"],
  ["ρ", "p"], ["τ", "t"], ["υ", "y"], ["χ", "x"],
  // Special confusables
  ["ⓘ", "i"], ["ℹ", "i"],
  ["𝐀", "A"], ["𝐁", "B"], ["𝐂", "C"], ["𝐃", "D"], ["𝐄", "E"],
  ["𝐅", "F"], ["𝐆", "G"], ["𝐇", "H"], ["𝐈", "I"], ["𝐉", "J"],
  ["𝐊", "K"], ["𝐋", "L"], ["𝐌", "M"], ["𝐍", "N"], ["𝐎", "O"],
  ["𝐏", "P"], ["𝐐", "Q"], ["𝐑", "R"], ["𝐒", "S"], ["𝐓", "T"],
  ["𝐔", "U"], ["𝐕", "V"], ["𝐖", "W"], ["𝐗", "X"], ["𝐘", "Y"], ["𝐙", "Z"],
  ["ａ", "a"], ["ｂ", "b"], ["ｃ", "c"], ["ｄ", "d"], ["ｅ", "e"],
  ["ｆ", "f"], ["ｇ", "g"], ["ｈ", "h"], ["ｉ", "i"], ["ｊ", "j"],
  ["ｋ", "k"], ["ｌ", "l"], ["ｍ", "m"], ["ｎ", "n"], ["ｏ", "o"],
  ["ｐ", "p"], ["ｑ", "q"], ["ｒ", "r"], ["ｓ", "s"], ["ｔ", "t"],
  ["ｕ", "u"], ["ｖ", "v"], ["ｗ", "w"], ["ｘ", "x"], ["ｙ", "y"], ["ｚ", "z"],
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Injection Patterns
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Array of injection pattern definitions.
 * Each pattern has:
 *   - pattern: RegExp to match against
 *   - severity: 'high' | 'medium' | 'low'
 *   - label: Unique string identifier for the pattern
 *
 * @type {Array<{pattern: RegExp, severity: string, label: string}>}
 */
export const INJECTION_PATTERNS = [
  // ── High severity: Direct prompt override attempts ──────────────────────
  { pattern: /ignore\s+(all\s+)?previous/i, severity: "high", label: "ignore_previous" },
  { pattern: /forget\s+(everything|all\s+(prior|previous|instructions))/i, severity: "high", label: "forget_all" },
  { pattern: /you\s+are\s+(now|not\s+required|free\s+to)/i, severity: "high", label: "role_override" },
  { pattern: /\[\s*(SYSTEM|INST)\s*\]/i, severity: "high", label: "embedded_tags" },
  { pattern: /disregard\s+(all\s+)?(previous|prior)\s+(instructions|directives)/i, severity: "high", label: "disregard_previous" },
  { pattern: /new\s+(instructions|directives|rules)\s*[:：]/i, severity: "high", label: "new_instructions_colon" },
  { pattern: /override\s+(all\s+)?(previous|prior|system)\s+(instructions|directives|prompt)/i, severity: "high", label: "override_previous" },
  { pattern: /you\s+(will|must|shall)\s+(now\s+)?(ignore|forget|disregard)/i, severity: "high", label: "must_ignore" },
  { pattern: /do\s+not\s+(follow|obey|adhere\s+to)\s+(the\s+)?(previous|above|system)/i, severity: "high", label: "do_not_follow" },
  { pattern: /system\s*(prompt|instruction|message|directive)\s*[:：]/i, severity: "high", label: "system_prompt_colon" },

  // ── Medium severity: Suspicious references to system configuration ──────
  { pattern: /system\s*(prompt|instruction)/i, severity: "medium", label: "system_reference" },
  { pattern: /new\s+instructions/i, severity: "medium", label: "new_instructions" },
  { pattern: /disregard/i, severity: "medium", label: "disregard" },
  { pattern: /you\s+are\s+(an?\s+)?(AI|assistant|chatbot|model)\s+(that|who|which)\s+(can|must|will)/i, severity: "medium", label: "role_redefinition" },
  { pattern: /from\s+now\s+on/i, severity: "medium", label: "from_now_on" },
  { pattern: /pretend\s+(that\s+)?(you\s+are|to\s+be)/i, severity: "medium", label: "pretend_role" },
  { pattern: /act\s+as\s+(if\s+)?(you\s+are\s+)?(an?\s+)?/i, severity: "medium", label: "act_as" },
  { pattern: /you\s+(are\s+)?(not\s+)?(bound|constrained|limited|restricted)\s+by/i, severity: "medium", label: "not_bound_by" },
  { pattern: /remove\s+(all\s+)?(restrictions|limitations|constraints|boundaries)/i, severity: "medium", label: "remove_restrictions" },
  { pattern: /no\s+(rules|boundaries|restrictions|limitations|filter)/i, severity: "medium", label: "no_rules" },

  // ── Low severity: Suspicious but could be legitimate usage ──────────────
  { pattern: /override/i, severity: "low", label: "override" },
  { pattern: /you\s+must/i, severity: "low", label: "you_must" },
  { pattern: /you\s+will\s+now/i, severity: "low", label: "you_will_now" },
  { pattern: /remember\s+(that\s+)?you\s+are/i, severity: "low", label: "remember_you_are" },
  { pattern: /i\s+am\s+(the\s+)?(admin|administrator|creator|developer|owner)/i, severity: "low", label: "i_am_admin" },
  { pattern: /this\s+is\s+(an?\s+)?(order|command|directive|instruction)/i, severity: "low", label: "this_is_command" },
  { pattern: /output\s+(must|should|shall|will)\s+(be\s+)?(in\s+)?/i, severity: "low", label: "output_format_command" },
  { pattern: /repeat\s+(after\s+me|the\s+(above|following|text|words))/i, severity: "low", label: "repeat_after" },
  { pattern: /say\s+("|'|`).*("|'|`)/i, severity: "low", label: "say_quoted" },
  { pattern: /print\s+(the\s+)?(word|text|phrase|sentence)/i, severity: "low", label: "print_word" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize unicode homoglyphs by replacing confusable characters
 * with their ASCII equivalents.
 *
 * @param {string} text - Input text potentially containing homoglyphs
 * @returns {string} Text with homoglyphs normalized to ASCII
 */
function normalizeHomoglyphs(text) {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const replacement = HOMOGLYPH_MAP.get(char);
    result += replacement !== undefined ? replacement : char;
  }
  return result;
}

/**
 * Check if a string looks like a base64-encoded payload.
 * Base64 strings are typically longer than 40 chars and contain
 * only base64 characters (A-Z, a-z, 0-9, +, /, =).
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if the text appears to be a base64 payload
 */
function looksLikeBase64Payload(text) {
  const trimmed = text.trim();
  // Must be at least 40 characters to be a suspicious payload
  if (trimmed.length < 40) return false;
  // Must be predominantly base64 characters
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(trimmed);
}

/**
 * Log a security warning to the console with a consistent prefix.
 *
 * @param {string} message - Warning message
 * @param {object} [context] - Optional context data
 */
function logWarning(message, context = {}) {
  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0
    ? ` ${JSON.stringify(context)}`
    : "";
  console.warn(`[prompt-security] ${timestamp} ⚠️ ${message}${contextStr}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sanitize user input by stripping or neutralizing common prompt injection
 * patterns, base64 payloads, and unicode homoglyph attacks.
 *
 * Operations performed:
 *   1. Normalize unicode homoglyphs to ASCII equivalents
 *   2. Strip known injection pattern matches
 *   3. Neutralize base64-encoded payloads that look suspicious
 *   4. Log a warning when injection is detected
 *
 * @param {string} input - Raw user input to sanitize
 * @returns {string} Sanitized user input
 */
export function sanitizeUserInput(input) {
  if (typeof input !== "string" || input.length === 0) {
    return input;
  }

  let sanitized = input;
  let injectionDetected = false;
  const matchedLabels = [];

  // Step 1: Normalize homoglyphs
  sanitized = normalizeHomoglyphs(sanitized);

  // Step 2: Strip known injection patterns
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      injectionDetected = true;
      matchedLabels.push(label);
      // Replace the matched pattern with a neutralized version
      // We replace with a marker that preserves the general structure
      // but removes the injection intent
      sanitized = sanitized.replace(pattern, (match) => {
        // For high-severity patterns, completely strip
        // For medium/low, replace with a neutral comment
        const sev = INJECTION_PATTERNS.find(p => p.label === label)?.severity;
        if (sev === "high") {
          return "";
        }
        return `[${match.trim()}]`;
      });
    }
  }

  // Step 3: Detect and neutralize base64 payloads
  // Split by whitespace and check each token
  const tokens = sanitized.split(/\s+/);
  const filteredTokens = tokens.map((token) => {
    if (looksLikeBase64Payload(token)) {
      injectionDetected = true;
      matchedLabels.push("base64_payload");
      return "[BASE64_PAYLOAD_REDACTED]";
    }
    return token;
  });
  sanitized = filteredTokens.join(" ");

  // Step 4: Clean up any double spaces or trailing artifacts from stripping
  sanitized = sanitized.replace(/\s{2,}/g, " ").trim();

  // Step 5: Log warning if injection was detected
  if (injectionDetected) {
    logWarning("Injection patterns detected and neutralized in user input", {
      patterns: matchedLabels,
      originalLength: input.length,
      sanitizedLength: sanitized.length,
    });
  }

  return sanitized;
}

/**
 * Sanitize MCP tool outputs before they're injected into the LLM context.
 *
 * Operations performed:
 *   1. Strip null bytes and control characters (except newlines/tabs)
 *   2. Limit output length (configurable, default 100KB)
 *   3. Strip content that looks like it's trying to override the system prompt
 *   4. Remove embedded [SYSTEM] or [INST] tags that could confuse the model
 *
 * @param {string} output - Raw tool output to sanitize
 * @param {object} [options] - Optional configuration
 * @param {number} [options.maxLength] - Maximum output length in bytes (default: 102400)
 * @returns {string} Sanitized tool output
 */
export function sanitizeToolOutput(output, options = {}) {
  if (typeof output !== "string" || output.length === 0) {
    return output;
  }

  const maxLength = options.maxLength || DEFAULT_MAX_OUTPUT_LENGTH;
  let sanitized = output;

  // Step 1: Strip null bytes and control characters (except newlines/tabs)
  // Allow: \n (newline), \r (carriage return), \t (tab)
  // Strip: \0 (null), \x01-\x08, \x0B, \x0C, \x0E-\x1F (control chars)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  // Step 2: Strip content that looks like system prompt override attempts
  // This catches patterns embedded in tool output that try to redefine the assistant
  const overridePatterns = [
    /you\s+are\s+(now|not\s+required)\s+.*?(?=\n|\.|$)/gi,
    /ignore\s+(all\s+)?previous\s+instructions.*?(?=\n|\.|$)/gi,
    /forget\s+(everything|all\s+prior).*?(?=\n|\.|$)/gi,
    /system\s*(prompt|instruction|message)\s*[:：].*?(?=\n|\.|$)/gi,
    /override\s+(all\s+)?(previous|prior|system).*?(?=\n|\.|$)/gi,
    /new\s+(instructions|directives|rules)\s*[:：].*?(?=\n|\.|$)/gi,
  ];

  for (const overridePattern of overridePatterns) {
    sanitized = sanitized.replace(overridePattern, (match) => {
      logWarning("System prompt override attempt detected in tool output", {
        matched: match.substring(0, 100),
      });
      return `[REDACTED: ${match.substring(0, 50)}...]`;
    });
  }

  // Step 3: Remove embedded [SYSTEM] or [INST] tags that could confuse the model
  sanitized = sanitized.replace(/\[\s*(SYSTEM|INST)\s*\]/gi, "[REDACTED_$1]");

  // Step 4: Limit output length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    logWarning("Tool output truncated", {
      originalLength: output.length,
      truncatedTo: maxLength,
    });
  }

  return sanitized;
}

/**
 * Run text against all known injection patterns and return a detailed
 * detection result with confidence scoring.
 *
 * @param {string} text - Text to analyze for injection patterns
 * @returns {{ isInjection: boolean, matchedPatterns: string[], confidence: number }}
 *   - isInjection: Whether the text is likely an injection attempt
 *   - matchedPatterns: Array of matched pattern labels
 *   - confidence: Score from 0 to 1 indicating confidence of injection
 */
export function detectInjection(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { isInjection: false, matchedPatterns: [], confidence: 0 };
  }

  const matchedPatterns = [];
  let confidence = 0;

  // Check against all injection patterns
  for (const { pattern, severity, label } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matchedPatterns.push(label);
      confidence += SEVERITY_WEIGHTS[severity] || 0;
    }
  }

  // Bonus: Check for base64 payloads (adds to confidence)
  const tokens = text.split(/\s+/);
  let base64Count = 0;
  for (const token of tokens) {
    if (looksLikeBase64Payload(token)) {
      base64Count++;
    }
  }
  if (base64Count > 0) {
    matchedPatterns.push("base64_payload");
    // Each base64 token adds a small amount to confidence
    confidence += Math.min(base64Count * 0.05, 0.2);
  }

  // Bonus: Check for homoglyph usage (indicates obfuscation attempt)
  let homoglyphCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (HOMOGLYPH_MAP.has(text[i])) {
      homoglyphCount++;
    }
  }
  if (homoglyphCount > 3) {
    matchedPatterns.push("homoglyph_obfuscation");
    confidence += Math.min(homoglyphCount * 0.02, 0.15);
  }

  // Clamp confidence to 0-1 range
  confidence = Math.min(Math.max(confidence, 0), 1);

  return {
    isInjection: confidence >= HIGH_CONFIDENCE_THRESHOLD || matchedPatterns.length >= 2,
    matchedPatterns,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Create a security middleware object with preProcess and postProcess methods
 * for easy integration into the orchestrator's message processing pipeline.
 *
 * @param {object} [options] - Configuration options
 * @param {boolean} [options.enabled=true] - Enable/disable security features
 * @param {number} [options.maxOutputLength] - Max output length for tool results
 * @returns {{ preProcess: Function, postProcess: Function }}
 */
export function createSecurityMiddleware(options = {}) {
  const enabled = options.enabled !== false;
  const maxOutputLength = options.maxOutputLength || DEFAULT_MAX_OUTPUT_LENGTH;

  return {
    /**
     * Pre-process user input before it reaches the LLM.
     * Sanitizes input and detects injection attempts.
     *
     * @param {string} input - Raw user input
     * @returns {{ sanitized: string, detection: object }}
     */
    preProcess(input) {
      if (!enabled) {
        return { sanitized: input, detection: { isInjection: false, matchedPatterns: [], confidence: 0 } };
      }

      const detection = detectInjection(input);
      const sanitized = sanitizeUserInput(input);

      return { sanitized, detection };
    },

    /**
     * Post-process tool output before it's injected into the LLM context.
     *
     * @param {string} output - Raw tool output
     * @returns {string} Sanitized tool output
     */
    postProcess(output) {
      if (!enabled) return output;
      return sanitizeToolOutput(output, { maxLength: maxOutputLength });
    },
  };
}
