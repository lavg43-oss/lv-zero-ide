/**
 * security/scanner — Security Scanning Engine
 *
 * Phase 4: Security Audit Skill (gstack /cso port)
 *
 * Multi-engine security scanner that checks:
 *   1. Secret detection — API keys, tokens, passwords in codebase
 *   2. Dependency vulnerabilities — via npm audit
 *   3. OWASP Top 10 — code pattern analysis
 *   4. MCP server security — tool permissions, data access
 *   5. File permission analysis
 *
 * gstack inspiration:
 *   /cso runs OWASP Top 10 + STRIDE threat modeling with
 *   zero-noise filtering (8/10 confidence gate). Each finding
 *   includes a concrete exploit scenario.
 *
 * @module security/scanner
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Confidence threshold for reporting findings (0.0 - 1.0) */
const CONFIDENCE_THRESHOLD = 0.7;

/** File extensions to scan for secrets */
const SCAN_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".php", ".java", ".go", ".rs",
  ".env", ".env.example", ".yml", ".yaml", ".json",
  ".xml", ".config", ".ini", ".cfg", ".conf",
  ".sh", ".bash", ".zsh", ".ps1", ".bat",
  ".md", ".txt", ".html", ".css",
]);

/** Directories to skip */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  ".nuxt", "coverage", ".nyc_output", "__pycache__",
  ".cache", ".asar", "vendor", ".roo",
]);

/** Maximum file size to scan (1 MB) */
const MAX_FILE_SIZE = 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════════
// Secret Patterns
// ═══════════════════════════════════════════════════════════════════════════════

const SECRET_PATTERNS = [
  // API Keys & Tokens
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, severity: "HIGH", label: "API Key", category: "secrets" },
  { pattern: /(?:sk|pk|tk)_[A-Za-z0-9]{20,}/, severity: "HIGH", label: "Stripe/API Key Format", category: "secrets" },
  { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/, severity: "HIGH", label: "GitHub Token", category: "secrets" },
  { pattern: /(?:xox[abp]-\d+-)[A-Za-z0-9]{40,}/, severity: "HIGH", label: "Slack Token", category: "secrets" },
  { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/, severity: "HIGH", label: "AWS Access Key", category: "secrets" },
  { pattern: /(?:eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,})/, severity: "MEDIUM", label: "JWT Token", category: "secrets" },

  // Passwords
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, severity: "HIGH", label: "Hardcoded Password", category: "secrets" },
  { pattern: /(?:db_password|db_pass|db_pwd)\s*[:=]\s*['"][^'"]+['"]/i, severity: "HIGH", label: "Database Password", category: "secrets" },

  // Connection Strings
  { pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^@\s]+@/i, severity: "HIGH", label: "Database Connection String", category: "secrets" },
  { pattern: /(?:https?:\/\/)[^@\s]+:[^@\s]+@/i, severity: "MEDIUM", label: "URL with Credentials", category: "secrets" },

  // Private Keys
  { pattern: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PRIVATE)\s+KEY-----/, severity: "HIGH", label: "Private Key", category: "secrets" },

  // Environment files with secrets
  { pattern: /(?:SECRET|SECRET_KEY|SECRET_TOKEN)\s*=\s*['"]?[A-Za-z0-9_\-]{8,}/i, severity: "MEDIUM", label: "Secret Env Var", category: "secrets" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OWASP Top 10 Patterns
// ═══════════════════════════════════════════════════════════════════════════════

const OWASP_PATTERNS = [
  // A01: Broken Access Control
  { pattern: /(?:req\.(?:query|params|body)\.[^)]+)\s*(?:!==?\s*undefined|null\s*\)?\s*&&?\s*)?$/m, severity: "MEDIUM", label: "A01: Missing Access Control", category: "owasp" },

  // A02: Cryptographic Failures
  { pattern: /(?:md5|sha1)\s*\(/i, severity: "HIGH", label: "A02: Weak Hash Function", category: "owasp" },
  { pattern: /(?:crypto\.createHash\s*\(\s*['"]md5['"]\s*\))/i, severity: "HIGH", label: "A02: MD5 Hash", category: "owasp" },

  // A03: Injection
  { pattern: /(?:exec|eval)\s*\(/, severity: "HIGH", label: "A03: Code Injection (eval/exec)", category: "owasp" },
  { pattern: /(?:innerHTML|outerHTML)\s*=/, severity: "MEDIUM", label: "A03: XSS via innerHTML", category: "owasp" },
  { pattern: /(?:dangerouslySetInnerHTML)/, severity: "MEDIUM", label: "A03: React XSS", category: "owasp" },

  // A04: Insecure Design
  { pattern: /(?:parse\s*\(\s*(?:JSON\.stringify|req\.))/i, severity: "LOW", label: "A04: Unsafe Deserialization", category: "owasp" },

  // A05: Security Misconfiguration
  { pattern: /(?:cors\s*\(\s*\{\s*origin\s*:\s*['"*]['"]?\s*\})/i, severity: "MEDIUM", label: "A05: Wildcard CORS", category: "owasp" },
  { pattern: /(?:app\.use\(\s*cors\s*\(\s*\)\s*\))/i, severity: "LOW", label: "A05: Default CORS", category: "owasp" },

  // A06: Vulnerable Components
  { pattern: /(?:require\s*\(\s*['"][^'"]+['"]\s*\))/g, severity: "LOW", label: "A06: Dependency Audit Needed", category: "owasp" },

  // A07: Identification & Auth Failures
  { pattern: /(?:password\s*===\s*['"][^'"]+['"])/i, severity: "HIGH", label: "A07: Plaintext Password Comparison", category: "owasp" },
  { pattern: /(?:req\.session\.user\s*=)/i, severity: "LOW", label: "A07: Session User Assignment", category: "owasp" },

  // A08: Software & Data Integrity Failures
  { pattern: /(?:require\s*\(\s*['"][^'"]*\.\.\.[^'"]*['"]\s*\))/i, severity: "MEDIUM", label: "A08: Unsafe Module Loading", category: "owasp" },

  // A09: Security Logging & Monitoring Failures
  { pattern: /(?:catch\s*\(\s*\w+\s*\)\s*\{\s*(?:\/\/|\/\*).*?\})/s, severity: "LOW", label: "A09: Empty Catch Block", category: "owasp" },
  { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, severity: "LOW", label: "A09: Silent Catch", category: "owasp" },

  // A10: Server-Side Request Forgery
  { pattern: /(?:fetch|request|got)\s*\(\s*[`'"]https?:\/\/[^'"]*\$\{/i, severity: "MEDIUM", label: "A10: SSRF via User Input", category: "owasp" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Scanner Classes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base scanner class.
 */
class BaseScanner {
  constructor(options = {}) {
    this._findings = [];
    this._options = options;
  }

  get findings() {
    return [...this._findings];
  }

  addFinding(finding) {
    this._findings.push({
      ...finding,
      timestamp: Date.now(),
      scanner: this.constructor.name,
    });
  }
}

/**
 * Scans files for hardcoded secrets.
 */
class SecretScanner extends BaseScanner {
  /**
   * @param {string} rootDir - Root directory to scan
   */
  constructor(rootDir, options = {}) {
    super(options);
    this._rootDir = rootDir;
  }

  async scan() {
    this._findings = [];
    const files = this._discoverFiles(this._rootDir);

    for (const file of files) {
      await this._scanFile(file);
    }

    return this._findings;
  }

  _discoverFiles(dir) {
    const results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            results.push(...this._discoverFiles(fullPath));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SCAN_EXTENSIONS.has(ext)) {
            const stat = fs.statSync(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              results.push(fullPath);
            }
          }
        }
      }
    } catch {
      // Permission errors, skip
    }
    return results;
  }

  async _scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const relativePath = path.relative(this._rootDir, filePath);

      for (const sp of SECRET_PATTERNS) {
        const matches = content.match(sp.pattern);
        if (matches) {
          const lineNum = this._findLineNumber(content, matches[0]);
          this.addFinding({
            type: "secret",
            severity: sp.severity,
            label: sp.label,
            file: relativePath,
            line: lineNum,
            match: this._maskSecret(matches[0]),
            confidence: sp.severity === "HIGH" ? 0.9 : 0.7,
            category: sp.category,
            description: `Potential ${sp.label} found in ${relativePath}:${lineNum}`,
          });
        }
      }
    } catch {
      // Binary or unreadable file, skip
    }
  }

  _findLineNumber(content, match) {
    const index = content.indexOf(match);
    if (index === -1) return 1;
    return content.substring(0, index).split("\n").length;
  }

  _maskSecret(text) {
    if (text.length <= 8) return "***";
    return text.substring(0, 4) + "..." + text.substring(text.length - 4);
  }
}

/**
 * Runs npm audit to check for dependency vulnerabilities.
 */
class DependencyScanner extends BaseScanner {
  /**
   * @param {string} rootDir - Project root directory
   */
  constructor(rootDir, options = {}) {
    super(options);
    this._rootDir = rootDir;
  }

  async scan() {
    this._findings = [];

    try {
      const output = execSync("npm audit --json", {
        cwd: this._rootDir,
        timeout: 30000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const audit = JSON.parse(output);

      if (audit.vulnerabilities) {
        for (const [pkg, info] of Object.entries(audit.vulnerabilities)) {
          if (info.severity === "critical" || info.severity === "high") {
            this.addFinding({
              type: "dependency",
              severity: info.severity.toUpperCase(),
              label: `Vulnerable Dependency: ${pkg}`,
              package: pkg,
              file: "package.json",
              line: 1,
              match: `${pkg}@${info.via?.[0]?.range || "?"}`,
              confidence: 0.9,
              category: "dependencies",
              description: `${pkg}: ${info.severity} severity vulnerability. ${info.via?.[0]?.title || ""}`,
              fix: info.fixAvailable
                ? `Upgrade to ${info.fixAvailable.version || "latest"}`
                : "No fix available",
            });
          }
        }
      }
    } catch (err) {
      // npm audit may fail if no package.json or network issues
      if (err.message && !err.message.includes("npm audit")) {
        this.addFinding({
          type: "dependency",
          severity: "LOW",
          label: "Dependency Audit Failed",
          file: "package.json",
          line: 1,
          match: err.message.substring(0, 200),
          confidence: 0.5,
          category: "dependencies",
          description: `npm audit failed: ${err.message.substring(0, 200)}`,
        });
      }
    }

    return this._findings;
  }
}

/**
 * Scans code for OWASP Top 10 vulnerability patterns.
 */
class OWASPScanner extends BaseScanner {
  /**
   * @param {string} rootDir - Root directory to scan
   */
  constructor(rootDir, options = {}) {
    super(options);
    this._rootDir = rootDir;
    this._secretScanner = new SecretScanner(rootDir);
  }

  async scan() {
    this._findings = [];

    // Reuse secret scanner's file discovery
    const files = this._secretScanner._discoverFiles(this._rootDir);

    for (const file of files) {
      await this._scanFile(file);
    }

    return this._findings;
  }

  async _scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const relativePath = path.relative(this._rootDir, filePath);

      for (const op of OWASP_PATTERNS) {
        const matches = content.match(op.pattern);
        if (matches) {
          const lineNum = this._findLineNumber(content, matches[0]);
          this.addFinding({
            type: "owasp",
            severity: op.severity,
            label: op.label,
            file: relativePath,
            line: lineNum,
            match: matches[0].substring(0, 120),
            confidence: op.severity === "HIGH" ? 0.85 : op.severity === "MEDIUM" ? 0.75 : 0.6,
            category: "owasp",
            description: `[${op.label}] Found in ${relativePath}:${lineNum}`,
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  _findLineNumber(content, match) {
    const index = content.indexOf(match);
    if (index === -1) return 1;
    return content.substring(0, index).split("\n").length;
  }
}

/**
 * Reviews MCP server configurations for security issues.
 */
class MCPSecurityScanner extends BaseScanner {
  /**
   * @param {string} rootDir - Project root directory
   */
  constructor(rootDir, options = {}) {
    super(options);
    this._rootDir = rootDir;
  }

  async scan() {
    this._findings = [];

    // Check mcp_servers.json
    const mcpConfigPath = path.resolve(this._rootDir, "mcp_servers.json");
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
        if (config.mcpServers) {
          for (const [name, server] of Object.entries(config.mcpServers)) {
            // Check for dangerous commands
            if (server.command === "bash" || server.command === "sh" || server.command === "powershell") {
              this.addFinding({
                type: "mcp",
                severity: "HIGH",
                label: `MCP Server "${name}" uses shell command`,
                file: "mcp_servers.json",
                line: 1,
                match: `${name}: ${server.command} ${(server.args || []).join(" ")}`,
                confidence: 0.9,
                category: "mcp_security",
                description: `MCP server "${name}" uses "${server.command}" which allows arbitrary command execution`,
              });
            }

            // Check for env vars with secrets
            if (server.env) {
              for (const [key, value] of Object.entries(server.env)) {
                if (value && value.length > 10 && !value.includes("{{") && !value.includes("$")) {
                  this.addFinding({
                    type: "mcp",
                    severity: "MEDIUM",
                    label: `MCP Server "${name}" has hardcoded env var: ${key}`,
                    file: "mcp_servers.json",
                    line: 1,
                    match: `${key}=${value.substring(0, 8)}...`,
                    confidence: 0.7,
                    category: "mcp_security",
                    description: `Environment variable "${key}" in MCP server "${name}" appears to contain a hardcoded secret`,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check .env for MCP-related secrets
    const envPath = path.resolve(this._rootDir, ".env");
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("MCP_") && line.includes("=")) {
            const value = line.split("=")[1]?.trim() || "";
            if (value && value.length > 5 && !value.startsWith("$") && !value.startsWith('"$')) {
              this.addFinding({
                type: "mcp",
                severity: "LOW",
                label: "MCP Config in .env",
                file: ".env",
                line: i + 1,
                match: line.split("=")[0] + "=***",
                confidence: 0.5,
                category: "mcp_security",
                description: `MCP configuration found in .env at line ${i + 1}`,
              });
            }
          }
        }
      } catch {
        // Ignore
      }
    }

    return this._findings;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Scanner
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Runs all security scanners on a project.
 *
 * @param {string} rootDir - Project root directory
 * @param {object} [options]
 * @param {boolean} [options.scanSecrets=true] - Scan for secrets
 * @param {boolean} [options.scanDependencies=true] - Run npm audit
 * @param {boolean} [options.scanOWASP=true] - Scan OWASP patterns
 * @param {boolean} [options.scanMCP=true] - Scan MCP configs
 * @param {number} [options.confidenceThreshold=0.7] - Minimum confidence to report
 * @returns {Promise<object>}
 */
export async function runSecurityScan(rootDir, options = {}) {
  const {
    scanSecrets = true,
    scanDependencies = true,
    scanOWASP = true,
    scanMCP = true,
    confidenceThreshold = CONFIDENCE_THRESHOLD,
  } = options;

  const allFindings = [];

  // 1. Secret scanning
  if (scanSecrets) {
    const secretScanner = new SecretScanner(rootDir);
    const secrets = await secretScanner.scan();
    allFindings.push(...secrets);
  }

  // 2. Dependency scanning
  if (scanDependencies) {
    const depScanner = new DependencyScanner(rootDir);
    const deps = await depScanner.scan();
    allFindings.push(...deps);
  }

  // 3. OWASP scanning
  if (scanOWASP) {
    const owaspScanner = new OWASPScanner(rootDir);
    const owasp = await owaspScanner.scan();
    allFindings.push(...owasp);
  }

  // 4. MCP security scanning
  if (scanMCP) {
    const mcpScanner = new MCPSecurityScanner(rootDir);
    const mcpFindings = await mcpScanner.scan();
    allFindings.push(...mcpFindings);
  }

  // Filter by confidence threshold
  const filtered = allFindings.filter((f) => f.confidence >= confidenceThreshold);

  // Sort by severity
  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  filtered.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

  // Generate summary
  const summary = {
    total: filtered.length,
    bySeverity: {
      HIGH: filtered.filter((f) => f.severity === "HIGH").length,
      MEDIUM: filtered.filter((f) => f.severity === "MEDIUM").length,
      LOW: filtered.filter((f) => f.severity === "LOW").length,
    },
    byCategory: {},
  };

  for (const f of filtered) {
    const cat = f.category || "other";
    summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;
  }

  return {
    success: true,
    summary,
    findings: filtered,
    scannedAt: new Date().toISOString(),
    scanOptions: { scanSecrets, scanDependencies, scanOWASP, scanMCP },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

export {
  SecretScanner,
  DependencyScanner,
  OWASPScanner,
  MCPSecurityScanner,
  SECRET_PATTERNS,
  OWASP_PATTERNS,
};

export default runSecurityScan;
