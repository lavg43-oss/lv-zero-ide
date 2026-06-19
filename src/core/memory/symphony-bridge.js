/**
 * Symphony Bridge — IPC handler registration for memory operations.
 *
 * Registers `ipcMain.handle()` handlers for all `memory:*` channels
 * defined in Phase 2 of the Symphony integration plan.
 *
 * Channels registered:
 *   memory:store, memory:get, memory:search, memory:delete,
 *   memory:list-by-type, memory:stats, memory:share
 *
 * Usage (in main.cjs init()):
 *   const { registerMemoryIPC } = require('./core/memory/symphony-bridge.js');
 *   registerMemoryIPC(ipcMain);
 *
 * @module core/memory/symphony-bridge
 */

const { MemoryDatabase } = require('./database.cjs');

/**
 * Register all memory IPC handlers on the given ipcMain instance.
 *
 * Each handler extracts `projectPath` from the payload (required for
 * per-project DB operations), resolves the appropriate MemoryDatabase
 * instance, and delegates to the corresponding method.
 *
 * @param {object} ipcMain — the Electron ipcMain module
 */
function registerMemoryIPC(ipcMain) {
  if (!ipcMain) {
    console.warn('[SymphonyBridge] No ipcMain provided — skipping registration');
    return;
  }

  // ── memory:store ────────────────────────────────────────────────────────
  ipcMain.handle('memory:store', async (_event, payload) => {
    try {
      const { projectPath, ...neuronData } = payload;
      if (!projectPath) {
        return { success: false, error: 'projectPath is required' };
      }
      const db = MemoryDatabase.getInstance(projectPath);
      const neuron = db.storeNeuron(neuronData);
      return { success: true, id: neuron.id, neuron };
    } catch (err) {
      console.error('[SymphonyBridge] memory:store error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:get ──────────────────────────────────────────────────────────
  ipcMain.handle('memory:get', async (_event, payload) => {
    try {
      const { id, projectPath } = payload;
      if (!id) return { success: false, error: 'id is required' };
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const neuron = db.getNeuron(id);
      return { success: true, neuron };
    } catch (err) {
      console.error('[SymphonyBridge] memory:get error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:search ───────────────────────────────────────────────────────
  ipcMain.handle('memory:search', async (_event, payload) => {
    try {
      const { projectPath, ...opts } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const result = db.searchNeurons(opts);
      return { success: true, neurons: result.neurons, total: result.total };
    } catch (err) {
      console.error('[SymphonyBridge] memory:search error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:delete ───────────────────────────────────────────────────────
  ipcMain.handle('memory:delete', async (_event, payload) => {
    try {
      const { id, projectPath } = payload;
      if (!id) return { success: false, error: 'id is required' };
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const deleted = db.deleteNeuron(id);
      return { success: deleted };
    } catch (err) {
      console.error('[SymphonyBridge] memory:delete error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:list-by-type ─────────────────────────────────────────────────
  ipcMain.handle('memory:list-by-type', async (_event, payload) => {
    try {
      const { projectPath, type, ...opts } = payload;
      if (!projectPath) return { success: false, error: 'projectPath is required' };
      if (!type) return { success: false, error: 'type is required' };
      const db = MemoryDatabase.getInstance(projectPath);
      const result = db.listNeuronsByType(type, opts);
      return { success: true, neurons: result.neurons, total: result.total };
    } catch (err) {
      console.error('[SymphonyBridge] memory:list-by-type error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:stats ────────────────────────────────────────────────────────
  ipcMain.handle('memory:stats', async (_event, payload) => {
    try {
      const { projectPath } = payload || {};
      let stats;
      if (projectPath) {
        const db = MemoryDatabase.getInstance(projectPath);
        stats = db.getMemoryStats(projectPath);
      } else {
        const sym = MemoryDatabase.getSymphonyInstance();
        stats = sym.getMemoryStats();
      }
      return { success: true, stats };
    } catch (err) {
      console.error('[SymphonyBridge] memory:stats error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── memory:share — Cross-project memory sharing ─────────────────────────
  ipcMain.handle('memory:share', async (_event, payload) => {
    try {
      const sym = MemoryDatabase.getSymphonyInstance();
      const result = sym.shareMemory(payload);
      return { success: true, id: result.id };
    } catch (err) {
      console.error('[SymphonyBridge] memory:share error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[SymphonyBridge] Memory IPC handlers registered');
}

module.exports = { registerMemoryIPC };
