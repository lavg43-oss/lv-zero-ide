/**
 * Sandbox security policies. 4 levels: isolated, sandboxed, restricted, full.
 */
export const POLICY_LEVELS = {
  isolated: { name: "Aislado", allow: { fs: false, net: false, proc: false, env: false }, allowedPaths: [], allowedDomains: [], allowedCmds: [], blockedCmds: [], maxMem: 64e6, maxCpu: 5000, maxOut: 1e6 },
  sandboxed: { name: "Sandbox", allow: { fs: true, net: true, proc: false, env: false }, allowedPaths: ["/tmp", "./sandbox-tmp"], allowedDomains: ["api.openai.com", "api.anthropic.com", "*.googleapis.com"], allowedCmds: [], blockedCmds: [], maxMem: 256e6, maxCpu: 30000, maxOut: 5e6 },
  restricted: { name: "Restringido", allow: { fs: true, net: true, proc: true, env: false }, allowedPaths: ["."], allowedDomains: [], allowedCmds: ["node","npm","npx","python","pip","git","ls","cat","echo","pwd","mkdir","cp","mv","rm"], blockedCmds: ["rm -rf /","rm -rf ~","sudo","chmod 777","dd","> /dev/sda","mkfs","fdisk","reboot","shutdown"], maxMem: 512e6, maxCpu: 60000, maxOut: 10e6 },
  full: { name: "Completo", allow: { fs: true, net: true, proc: true, env: true }, allowedPaths: [], allowedDomains: [], allowedCmds: [], blockedCmds: [], maxMem: 0, maxCpu: 0, maxOut: 0 },
};

export const DANGEROUS_PATTERNS = [
  /fs\.rmSync\s*\(\s*['"`]\/['"`]/, /fs\.rm\s*\(\s*['"`]\/['"`]/,
  /exec(?:Sync)?\s*\(\s*['"`]rm\s+-rf\s+[~\/]/, /process\.exit\s*\(/, /process\.kill\s*\(/,
  /nmap/, /cryptonight/, /miner\.start/,
  /fs\.readFileSync\s*\(\s*['"`]\/etc\/passwd['"`]/, /fs\.readFileSync\s*\(\s*['"`]\/\.ssh['"`]/,
  /\beval\s*\(/, /\bFunction\s*\(/, /new\s+Function\s*\(/,
];

export class SecurityPolicy {
  constructor(level = "sandboxed") {
    const c = POLICY_LEVELS[level] || POLICY_LEVELS.sandboxed;
    this.level = level;
    this.config = { ...c, allowedPaths: [...(c.allowedPaths||[])], allowedDomains: [...(c.allowedDomains||[])], allowedCmds: [...(c.allowedCmds||[])], blockedCmds: [...(c.blockedCmds||[])] };
  }

  checkFilePath(fp) {
    if (!this.config.allow.fs) return { allowed: false, reason: "FS disabled" };
    if (!this.config.allowedPaths.length) return { allowed: true };
    const n = fp.replace(/\\/g, "/");
    for (const a of this.config.allowedPaths) if (n.startsWith(a.replace(/\\/g, "/"))) return { allowed: true };
    return { allowed: false, reason: `Path not allowed: ${fp}` };
  }

  checkDomain(domain) {
    if (!this.config.allow.net) return { allowed: false, reason: "Network disabled" };
    if (!this.config.allowedDomains.length) return { allowed: true };
    for (const a of this.config.allowedDomains) {
      if (a.startsWith("*.") && domain.endsWith(a.slice(1))) return { allowed: true };
      if (domain === a || domain.endsWith(`.${a}`)) return { allowed: true };
    }
    return { allowed: false, reason: `Domain not allowed: ${domain}` };
  }

  checkCommand(cmd) {
    if (!this.config.allow.proc) return { allowed: false, reason: "Processes disabled" };
    for (const p of DANGEROUS_PATTERNS) if (p.test(cmd)) return { allowed: false, reason: `Dangerous pattern` };
    for (const b of this.config.blockedCmds) if (cmd.includes(b)) return { allowed: false, reason: `Blocked: ${b}` };
    if (this.config.allowedCmds.length) {
      const name = cmd.trim().split(/\s+/)[0];
      if (!this.config.allowedCmds.some(a => name === a || cmd.startsWith(a + " "))) return { allowed: false, reason: `Command not allowed: ${name}` };
    }
    return { allowed: true };
  }

  scanCode(code) {
    const violations = [];
    for (const p of DANGEROUS_PATTERNS) if (p.test(code)) violations.push(`Dangerous pattern`);
    return { safe: violations.length === 0, violations };
  }

  getResourceLimits() {
    return { maxMemory: this.config.maxMem, maxCpuTime: this.config.maxCpu, maxOutputSize: this.config.maxOut };
  }
}

export default SecurityPolicy;
