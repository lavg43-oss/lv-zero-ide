/**
 * lv-zero — ESM Entry Point (UNUSED — kept for reference)
 *
 * =====================================================================
 *  THIS FILE IS NOT LOADED BY THE CURRENT ELECTRON BOOT SEQUENCE.
 * =====================================================================
 *
 * package.json `"main"` field is set to `"src/main.cjs"`, which means
 * Electron loads `src/main.cjs` directly on `electron .` / `npm start`.
 *
 * ── History ──────────────────────────────────────────────────────────
 *
 * This file was originally created as an ESM wrapper for Electron 42
 * to work around a module resolution issue where `require("electron")`
 * in an ESM context resolved to the npm package (returning a string path
 * to electron.exe) instead of Electron's built-in module.
 *
 * The file employed two strategies:
 *   1. Rename the npm `electron/index.js` to `index.js.bak` so that
 *      Electron's built-in module registration could intercept the
 *      `'electron'` module name.
 *   2. As a fallback, monkey-patch Module._resolveFilename to throw
 *      MODULE_NOT_FOUND for `'electron'`, triggering Electron's
 *      fallback built-in resolution.
 *
 * Both strategies were fragile (CRITICAL #4 in the audit) and are no
 * longer needed because:
 *   - `"main": "src/main.cjs"` loads a CJS file, where
 *     `require("electron")` resolves correctly to the built-in module
 *   - The ESM approach was tried and reverted (see SESSION_LOG.md)
 *
 * ── What to do if needed again ───────────────────────────────────────
 *
 * If an ESM entry point is ever required again, use the standard
 * `createRequire(import.meta.url)` pattern instead of patching
 * Node.js internals:
 *
 *   import { createRequire } from 'module';
 *   const require = createRequire(import.meta.url);
 *   const electron = require('electron');
 *
 * See also: https://nodejs.org/api/module.html#modulecreaterequirefilename
 * =====================================================================
 */

/* Original code preserved below for reference — NOT executed */

/*
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

if (process.versions && process.versions.electron) {
  const npmPkgIndex = path.join(process.cwd(), 'node_modules', 'electron', 'index.js');
  const npmPkgBak = npmPkgIndex + '.bak';
  let wasRenamed = false;

  // Rename the npm package's index.js so Electron's built-in module is used
  if (fs.existsSync(npmPkgIndex) && !fs.existsSync(npmPkgBak)) {
    try {
      fs.renameSync(npmPkgIndex, npmPkgBak);
      wasRenamed = true;
      // Clear any cached reference to the npm package
      for (const [key] of Object.entries(require.cache)) {
        if (key.includes('node_modules') && key.includes('electron') && (key.includes('index.js') || key.includes('cli.js'))) {
          delete require.cache[key];
        }
      }
      console.log("[Entry] Renamed npm electron/index.js to access built-in module");
    } catch (err) {
      console.warn("[Entry] Could not rename npm package:", err.message);
    }
  }

  // Now require('electron') should resolve to Electron's built-in module
  let electron;
  try {
    electron = require("electron");
  } catch (e) {
    console.error("[Entry] Failed to require electron:", e.message);
    // Restore backup before exiting
    if (wasRenamed && fs.existsSync(npmPkgBak)) {
      try { fs.renameSync(npmPkgBak, npmPkgIndex); } catch (_) {}
    }
    process.exit(1);
  }

  if (typeof electron === 'string') {
    // Still a string — built-in module not intercepting
    console.warn("[Entry] Built-in module not found via rename. Trying restore+override...");

    // Restore the backup
    if (fs.existsSync(npmPkgBak)) {
      try { fs.renameSync(npmPkgBak, npmPkgIndex); } catch (_) {}
    }

    // Now try Module._resolveFilename override approach
    const Module = require("module");
    const origResolve = Module._resolveFilename;

    Module._resolveFilename = function(request, parent, isMain) {
      if (request === 'electron') {
        // Force resolution to a non-existent path to trigger
        // Electron's fallback built-in module resolution
        const err = new Error(`Cannot find module 'electron'`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return origResolve.call(this, request, parent, isMain);
    };

    try {
      electron = require("electron");
    } catch (e) {
      console.error("[Entry] Module override approach also failed:", e.message);
      Module._resolveFilename = origResolve;
      process.exit(1);
    }
    Module._resolveFilename = origResolve;
  }

  if (typeof electron === 'object' && electron !== null && electron.app) {
    globalThis.__electron = electron;
    console.log("[Entry] Electron API ready — app:", typeof electron.app !== "undefined");
    require("./main.cjs");
  } else {
    console.error("[Entry] Could not obtain real Electron API. Type:", typeof electron);
    // Restore backup
    if (wasRenamed && fs.existsSync(npmPkgBak)) {
      try { fs.renameSync(npmPkgBak, npmPkgIndex); } catch (_) {}
    }
    process.exit(1);
  }
} else {
  console.error("[Entry] Not running inside Electron. Use 'npm run electron'.");
  process.exit(1);
}
*/
