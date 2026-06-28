/**
 * ─── Screenshot Module — System Screen Capture ────────────────────────────
 *
 * Captura la pantalla completa del sistema usando herramientas nativas del SO.
 *
 * NOTA: Para screenshots de páginas web, usar el BrowserDaemon
 * (src/browser/daemon.js) vía browser_automation skill, que es muy superior:
 *   - Chromium persistente (~100ms por comando)
 *   - Auto-shutdown por inactividad (30min)
 *   - Health checks con auto-restart
 *   - Multi-tab, cookies, auth, rate limiting
 *   - Stealth mode anti-detección
 *
 * Este módulo SOLO se usa para capturar la pantalla del sistema completo
 * (no una página web), funcionalidad que el BrowserDaemon no cubre.
 *
 * v1.0 — Junio 2026
 *
 * @module vision/screenshot
 */

import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════════
// System Screen Capture
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Captura un screenshot de la pantalla completa del sistema.
 * Usa herramientas nativas del SO:
 *   - Windows: PowerShell + System.Windows.Forms
 *   - macOS: screencapture
 *   - Linux: import (ImageMagick) o scrot
 *
 * @param {object} [options]
 * @param {string} [options.savePath] - Ruta para guardar la imagen
 * @returns {Promise<{success: boolean, buffer?: Buffer, path?: string, size?: number, error?: string}>}
 *
 * @example
 * const shot = await captureScreen();
 * // { success: true, buffer: <Buffer>, path: '/tmp/screen-xxx.png', size: 245000 }
 */
export async function captureScreen(options = {}) {
  const platform = process.platform;

  try {
    let buffer;
    const screenshotsDir = path.resolve(process.cwd(), ".lv-zero", "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const filePath = options.savePath || path.join(screenshotsDir, `screen-${Date.now()}.png`);

    if (platform === "win32") {
      // Windows: PowerShell para capturar pantalla
      const { execSync } = await import("child_process");
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $image = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($image)
        $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $screen.Size)
        $image.Save('${filePath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
        $graphics.Dispose()
        $image.Dispose()
      `;
      execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, { timeout: 15000 });
      buffer = fs.readFileSync(filePath);
    } else if (platform === "darwin") {
      // macOS: screencapture
      const { execSync } = await import("child_process");
      execSync(`screencapture -x "${filePath}"`, { timeout: 15000 });
      buffer = fs.readFileSync(filePath);
    } else {
      // Linux: import (ImageMagick) o scrot
      const { execSync } = await import("child_process");
      try {
        execSync(`import -window root "${filePath}"`, { timeout: 15000 });
      } catch {
        execSync(`scrot "${filePath}"`, { timeout: 15000 });
      }
      buffer = fs.readFileSync(filePath);
    }

    return {
      success: true,
      buffer,
      path: filePath,
      size: buffer.length,
    };
  } catch (err) {
    return {
      success: false,
      error: `System screen capture failed: ${err.message}`,
    };
  }
}

/**
 * Convierte un buffer de imagen a base64 para APIs de visión.
 * @param {Buffer} buffer - Buffer de la imagen
 * @returns {string}
 */
export function screenshotToBase64(buffer) {
  return buffer.toString("base64");
}

export default { captureScreen, screenshotToBase64 };
