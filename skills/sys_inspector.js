/**
 * sys_inspector — System Inspector Tool for lv-zero
 *
 * Recopila información del sistema usando el módulo nativo `os` de Node.js.
 * v1.0 — Examen de Graduación
 */
import os from "os";

// ─── Helper: Formatear uptime (segundos → días, horas, minutos) ────────────
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

// ─── Helper: Calcular uso de CPU como porcentaje ──────────────────────────
function getCPUUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const idlePercent = (totalIdle / totalTick) * 100;
  const usagePercent = Math.round((100 - idlePercent) * 100) / 100;

  return {
    usagePercent,
    cores: cpus.length,
    model: cpus[0]?.model || "Desconocido",
  };
}

// ─── Helper: Memoria ───────────────────────────────────────────────────────
function getMemoryInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const toGB = (bytes) => Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
  const usagePercent = Math.round((usedMem / totalMem) * 10000) / 100;

  return {
    totalGB: toGB(totalMem),
    freeGB: toGB(freeMem),
    usedGB: toGB(usedMem),
    usagePercent,
  };
}

export default {
  name: "sys_inspector",
  description:
    "Recopila información del sistema: SO, uptime, CPU (modelo, núcleos, uso %), " +
    "y memoria (total, libre, usada en GB con %). No requiere parámetros.",

  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  handler: async () => {
    try {
      const cpuInfo = getCPUUsage();
      const memInfo = getMemoryInfo();

      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        system: {
          platform: os.platform(),
          release: os.release(),
          hostname: os.hostname(),
          arch: os.arch(),
          uptimeSeconds: os.uptime(),
          uptimeFormatted: formatUptime(os.uptime()),
        },
        cpu: {
          model: cpuInfo.model,
          cores: cpuInfo.cores,
          usagePercent: cpuInfo.usagePercent,
        },
        memory: {
          totalGB: memInfo.totalGB,
          freeGB: memInfo.freeGB,
          usedGB: memInfo.usedGB,
          usagePercent: memInfo.usagePercent,
        },
      };

      return result;
    } catch (err) {
      return {
        success: false,
        error: `Error al inspeccionar el sistema: ${err.message}`,
      };
    }
  },
};
