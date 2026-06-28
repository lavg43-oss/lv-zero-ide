/**
 * Sandbox — Secure code execution via Node.js vm module.
 */
import vm from "vm";
import { SecurityPolicy } from "./policy.js";

export class Sandbox {
  constructor(options = {}) {
    this._policy = options.policy || new SecurityPolicy(options.policyLevel || "sandboxed");
    this._timeout = options.timeout || 30000;
    this._contexts = new Map();
  }
  get policy() { return this._policy; }

  createContext(id, globals = {}) {
    const cid = id || `sb-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const sandbox = Object.freeze({
      console: { log: (...a) => this._capture(cid, "log", a), info: (...a) => this._capture(cid, "info", a), warn: (...a) => this._capture(cid, "warn", a), error: (...a) => this._capture(cid, "error", a) },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms||0, this._timeout)), clearTimeout,
      setInterval: (fn, ms) => setInterval(fn, Math.min(ms||0, this._timeout)), clearInterval,
      Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
      String, Number, Boolean, Array, Object, Map, Set, WeakMap, WeakSet, Promise, RegExp, Error,
      TypeError, RangeError, SyntaxError, ReferenceError,
      ...globals,
    });
    const ctx = { id: cid, sandbox, vmContext: vm.createContext(sandbox), output: [], startTime: null, endTime: null, active: false };
    this._contexts.set(cid, ctx);
    return cid;
  }

  async run(code, options = {}) {
    const scan = this._policy.scanCode(code);
    if (!scan.safe) return { success: false, output: [], error: `Security violation`, executionTime: 0, contextId: options.contextId || "none" };

    let cid = options.contextId;
    let ctx;
    if (cid && this._contexts.has(cid)) ctx = this._contexts.get(cid);
    else { cid = this.createContext(cid, options.globals||{}); ctx = this._contexts.get(cid); }

    ctx.active = true; ctx.startTime = Date.now(); ctx.output = [];
    const limits = this._policy.getResourceLimits();
    const timeout = Math.min(options.timeout||this._timeout, limits.maxCpuTime > 0 ? limits.maxCpuTime : this._timeout);

    try {
      const script = new vm.Script(code, { filename: options.filename || "sandbox.js", timeout });
      const result = script.runInContext(ctx.vmContext, { timeout, breakOnSigint: true });
      ctx.endTime = Date.now(); ctx.active = false;
      return { success: true, output: ctx.output.map(o => o.text), result, executionTime: ctx.endTime - ctx.startTime, contextId: cid };
    } catch (err) {
      ctx.endTime = Date.now(); ctx.active = false;
      return { success: false, output: ctx.output.map(o => o.text), error: err.message, executionTime: ctx.endTime - ctx.startTime, contextId: cid };
    }
  }

  runSync(code, options = {}) {
    const scan = this._policy.scanCode(code);
    if (!scan.safe) return { success: false, error: `Security violation` };
    const limits = this._policy.getResourceLimits();
    const timeout = Math.min(options.timeout||this._timeout, limits.maxCpuTime > 0 ? limits.maxCpuTime : this._timeout);
    try {
      const s = new vm.Script(code, { filename: options.filename || "sb-sync.js", timeout });
      const sandbox = Object.freeze({ console: { log:()=>{},info:()=>{},warn:()=>{},error:()=>{} }, Math, Date, JSON, parseInt, parseFloat, String, Number, Boolean, Array, Object, Map, Set, Promise, RegExp, Error, ...options.globals });
      return { success: true, result: s.runInContext(vm.createContext(sandbox), { timeout, breakOnSigint: true }) };
    } catch (err) { return { success: false, error: err.message }; }
  }

  destroyContext(id) { const c = this._contexts.get(id); if (c) { c.active = false; c.output = []; this._contexts.delete(id); } }
  destroyAll() { for (const [id] of this._contexts) this.destroyContext(id); }

  getStats() {
    let active = 0;
    for (const [,c] of this._contexts) if (c.active) active++;
    return { activeContexts: active, totalContexts: this._contexts.size, policy: this._policy.level };
  }

  _capture(cid, level, args) {
    const ctx = this._contexts.get(cid);
    if (!ctx) return;
    ctx.output.push({ level, text: args.map(a => { try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch { return String(a); } }).join(" "), timestamp: Date.now() });
  }
}

export default Sandbox;
