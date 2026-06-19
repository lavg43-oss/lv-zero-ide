/**
 * lv-zero — Structured Error Types
 *
 * Provides a hierarchy of error classes for consistent error handling
 * across the application. Each error carries a machine-readable code and
 * optional details for IPC serialization.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Error Codes
// ═══════════════════════════════════════════════════════════════════════════════

export const ErrorCodes = {
  UNKNOWN: "UNKNOWN",
  CONFIG_ERROR: "CONFIG_ERROR",
  API_ERROR: "API_ERROR",
  TOOL_ERROR: "TOOL_ERROR",
  FS_ERROR: "FS_ERROR",
  STATE_ERROR: "STATE_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SECURITY_ERROR: "SECURITY_ERROR",
  RATE_LIMIT: "RATE_LIMIT",
  MCP_ERROR: "MCP_ERROR",
  STORAGE_ERROR: "STORAGE_ERROR",
  UNEXPECTED: "UNEXPECTED",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Base Error
// ═══════════════════════════════════════════════════════════════════════════════

export class LvError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} [code='UNKNOWN'] - Machine-readable error code
   * @param {object} [options={}] - Additional options
   * @param {*} [options.details=null] - Optional additional context
   * @param {boolean} [options.recoverable=false] - Whether the error is recoverable
   * @param {boolean} [options.fatal=false] - Whether the error is fatal
   */
  constructor(message, code = ErrorCodes.UNKNOWN, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = options.details || null;
    this.recoverable = options.recoverable !== false;
    this.fatal = options.fatal === true;
    this.timestamp = Date.now();

    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize the error for IPC transmission.
   * @returns {{ success: boolean, error: string, code: string, details: *, recoverable: boolean, fatal: boolean }}
   */
  toJSON() {
    return {
      success: false,
      error: this.message,
      code: this.code,
      details: this.details,
      recoverable: this.recoverable,
      fatal: this.fatal,
      name: this.name,
      timestamp: this.timestamp,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Specific Error Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration issues — invalid settings, missing config files, etc.
 */
export class ConfigurationError extends LvError {
  constructor(message, code = ErrorCodes.CONFIG_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * API call failures — network errors, unexpected responses, etc.
 */
export class APIError extends LvError {
  constructor(message, code = ErrorCodes.API_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * Tool execution failures — skill errors, timeouts, etc.
 */
export class ToolExecutionError extends LvError {
  constructor(message, code = ErrorCodes.TOOL_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * File system errors — file not found, permission denied, etc.
 */
export class FileSystemError extends LvError {
  constructor(message, code = ErrorCodes.FS_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * State management errors — corrupt state, save failures, etc.
 */
export class StateError extends LvError {
  constructor(message, code = ErrorCodes.STATE_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * Validation errors — invalid input, schema violations, etc.
 */
export class ValidationError extends LvError {
  constructor(message, code = ErrorCodes.VALIDATION_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * Security violations — unauthorized access, permission denied, etc.
 */
export class SecurityError extends LvError {
  constructor(message, code = ErrorCodes.SECURITY_ERROR, details = null) {
    super(message, code, { details, recoverable: false });
  }
}

/**
 * Rate limiting — too many requests, quota exceeded, etc.
 */
export class RateLimitError extends LvError {
  constructor(message, code = ErrorCodes.RATE_LIMIT, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * MCP connection issues — server unreachable, protocol errors, etc.
 */
export class MCPError extends LvError {
  constructor(message, code = ErrorCodes.MCP_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

/**
 * Storage issues — database errors, disk full, corrupt data, etc.
 */
export class StorageError extends LvError {
  constructor(message, code = ErrorCodes.STORAGE_ERROR, details = null) {
    super(message, code, { details, recoverable: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wraps any error into an LvError with proper code and context.
 *
 * @param {Error} err - The original error
 * @param {object} [options] - Override options
 * @param {string} [options.code] - Error code
 * @param {*} [options.context] - Additional context
 * @param {boolean} [options.recoverable] - Whether the error is recoverable
 * @param {boolean} [options.fatal] - Whether the error is fatal
 * @returns {LvError}
 */
export function toLvError(err, options = {}) {
  if (err instanceof LvError) {
    // Already an LvError — just add context if provided
    if (options.context) {
      err.details = { ...(err.details || {}), ...options.context };
    }
    return err;
  }

  const code = options.code || ErrorCodes.UNEXPECTED;
  const message = err?.message || String(err || "Unknown error");
  const lvErr = new LvError(message, code, {
    details: options.context || null,
    recoverable: options.recoverable !== false,
    fatal: options.fatal === true,
  });

  // Preserve original stack
  if (err?.stack) {
    lvErr.stack = `${lvErr.stack}\nCaused by: ${err.stack}`;
  }

  return lvErr;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backward Compat Aliases
// ═══════════════════════════════════════════════════════════════════════════════

/** @deprecated Use ConfigurationError instead */
export const ConfigError = ConfigurationError;

/** @deprecated Use LvError instead */
export const LvZeroError = LvError;
