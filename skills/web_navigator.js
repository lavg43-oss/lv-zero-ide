/**
 * web_navigator — Navegador Web Automatizado para lv-zero
 *
 * Permite al agente de lv-zero navegar sitios web, hacer login,
 * extraer contenido textual, hacer clic en elementos, llenar formularios
 * y explorar páginas como si fuera un usuario real.
 *
 * v1.0 — Mayo 2026
 *
 * Estrategia:
 *   - Usa Playwright (Chromium) para controlar un navegador headless.
 *   - NO usa screenshots (DeepSeek no tiene visión).
 *   - Extrae TEXTO estructurado: innerText, HTML semántico, enlaces,
 *     árbol de accesibilidad, tablas, listas, etc.
 *   - Browser singleton: una sola instancia reutilizable por sesión.
 */

import { chromium } from "playwright";

// ═════════════════════════════════════════════════════════════════════════════
// Global browser singleton (shared across calls within same session)
// ═════════════════════════════════════════════════════════════════════════════

/** @type {import("playwright").Browser | null} */
let __browser = null;

/** @type {import("playwright").BrowserContext | null} */
let __context = null;

/** @type {import("playwright").Page | null} */
let __page = null;

/** Timestamp of last browser activity (for auto-cleanup) */
let __lastActivity = 0;

/** Track if browser was launched by a specific action */
let __browserOwner = false;

// ─── Browser Lifecycle ──────────────────────────────────────────────────────

/**
 * Lanza el navegador si no está corriendo.
 * Usa Chromium en modo headless.
 */
async function ensureBrowser() {
  if (__browser && __browser.isConnected()) {
    __lastActivity = Date.now();
    return;
  }

  __browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-web-security", // Allow cross-origin requests
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  __context = await __browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/125.0.0.0 Safari/537.36",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    // Enable JavaScript, cookies, localStorage
    javaScriptEnabled: true,
    bypassCSP: true,
    ignoreHTTPSErrors: false,
  });

  __page = await __context.newPage();
  __page.setDefaultTimeout(30000);
  __page.setDefaultNavigationTimeout(45000);
  __browserOwner = true;
  __lastActivity = Date.now();
}

/**
 * Cierra el navegador y limpia recursos.
 */
async function closeBrowser() {
  try {
    if (__page) {
      try { await __page.close(); } catch { /* ignore */ }
      __page = null;
    }
    if (__context) {
      try { await __context.close(); } catch { /* ignore */ }
      __context = null;
    }
    if (__browser) {
      try { await __browser.close(); } catch { /* ignore */ }
      __browser = null;
    }
    __browserOwner = false;
    __lastActivity = 0;
  } catch { /* ignore */ }
}

/**
 * Obtiene el texto visible actual de la página.
 * Incluye metadatos útiles para el agente: URL, título, texto.
 */
async function getPageSnapshot(page) {
  const result = {
    url: page.url(),
    title: await page.title(),
    textContent: "",
    links: [],
    headings: [],
    interactive: [],
    forms: [],
    tables: [],
    statusCode: null,
  };

  try {
    result.textContent = await page.evaluate(() => {
      // Get visible text, excluding scripts, styles, hidden elements
      const clone = document.body.cloneNode(true);
      const removals = clone.querySelectorAll(
        "script, style, noscript, svg, " +
        "[aria-hidden=true], " +
        "[hidden], " +
        ".hidden, " +
        "nav, header, footer"
      );
      removals.forEach((el) => el.remove());
      return clone.innerText || "";
    });
  } catch { /* page might not be loaded */ }

  // Extract all links
  try {
    result.links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
          text: (a.innerText || "").trim().slice(0, 120),
          href: a.getAttribute("href") || "",
          title: a.getAttribute("title") || "",
        }))
        .filter((l) => l.href && !l.href.startsWith("#"))
        .slice(0, 200); // Limit to 200 links
    });
  } catch { /* ignore */ }

  // Extract headings (structure outline)
  try {
    result.headings = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
        .map((h) => ({
          level: parseInt(h.tagName[1]),
          text: (h.innerText || "").trim().slice(0, 200),
        }));
    });
  } catch { /* ignore */ }

  // Detect interactive elements
  try {
    result.interactive = await page.evaluate(() => {
      const items = [];
      // Buttons
      document.querySelectorAll("button, [role=button]").forEach((el) => {
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80);
        if (text) items.push({ type: "button", text, selector: guessSelector(el) });
      });
      // Inputs
      document.querySelectorAll("input:not([type=hidden])").forEach((el) => {
        const name = el.getAttribute("name") || el.getAttribute("id") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const type = el.getAttribute("type") || "text";
        items.push({ type: `input[${type}]`, name, placeholder, selector: guessSelector(el) });
      });
      // Selects
      document.querySelectorAll("select").forEach((el) => {
        const name = el.getAttribute("name") || el.getAttribute("id") || "";
        items.push({ type: "select", name, selector: guessSelector(el) });
      });
      // Textareas
      document.querySelectorAll("textarea").forEach((el) => {
        const name = el.getAttribute("name") || el.getAttribute("id") || "";
        items.push({ type: "textarea", name, selector: guessSelector(el) });
      });
      return items.slice(0, 100);

      function guessSelector(el) {
        if (el.getAttribute("data-testid")) return `[data-testid="${el.getAttribute("data-testid")}"]`;
        if (el.getAttribute("id")) return `#${el.getAttribute("id")}`;
        if (el.getAttribute("name")) return `[name="${el.getAttribute("name")}"]`;
        if (el.getAttribute("aria-label")) return `[aria-label="${el.getAttribute("aria-label")}"]`;
        // Build a simple class-based selector
        const classes = Array.from(el.classList).filter((c) => !c.startsWith("_") && !c.startsWith("ng-"));
        if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes[0]}`;
        return el.tagName.toLowerCase();
      }
    });
  } catch { /* ignore */ }

  // Detect forms
  try {
    result.forms = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("form")).map((f) => {
        const inputs = Array.from(f.querySelectorAll("input, select, textarea"))
          .map((el) => ({
            name: el.getAttribute("name") || el.getAttribute("id") || "",
            type: el.getAttribute("type") || el.tagName.toLowerCase(),
            placeholder: el.getAttribute("placeholder") || "",
            required: el.hasAttribute("required"),
          }));
        return {
          action: f.getAttribute("action") || "",
          method: (f.getAttribute("method") || "get").toUpperCase(),
          inputs,
          submitText: "",
        };
      });
    });
  } catch { /* ignore */ }

  // Extract tables (useful for structured data)
  try {
    result.tables = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("table")).map((table) => {
        const headers = Array.from(table.querySelectorAll("th")).map((th) => (th.innerText || "").trim());
        const rows = Array.from(table.querySelectorAll("tr")).slice(0, 20).map((tr) =>
          Array.from(tr.querySelectorAll("td, th")).map((td) => (td.innerText || "").trim())
        );
        return { headers, rows };
      });
    });
  } catch { /* ignore */ }

  // Truncate text content to avoid token overflow
  if (result.textContent.length > 30000) {
    result.textContent = result.textContent.slice(0, 30000) +
      `\n\n[... ${result.textContent.length - 30000} caracteres más truncados ...]`;
  }

  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// Skill Definition
// ═════════════════════════════════════════════════════════════════════════════

export default {
  name: "web_navigator",
  description:
    "🧭 Navegador web automatizado para lv-zero. " +
    "Permite navegar páginas web, hacer login, extraer contenido textual, " +
    "hacer clic en elementos, llenar formularios y explorar sitios. " +
    "NO usa screenshots (DeepSeek no tiene visión) — extrae TEXTO estructurado. " +
    "Ideal para explorar sitios web, documentación, cursos online, etc. " +
    "Usa Playwright (Chromium) en modo headless. " +
    "El browser se mantiene abierto entre llamadas para mantener la sesión.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "navigate",
          "click",
          "fill",
          "select",
          "get_text",
          "get_html",
          "get_links",
          "get_structure",
          "scroll",
          "wait",
          "screenshot",     // Only for debugging, agent can't see it
          "login",
          "extract_lessons", // Specialized: extract lesson/course content
          "close",
          "status",
        ],
        description:
          "Acción a ejecutar:\n" +
          "- 'navigate': Navegar a una URL\n" +
          "- 'click': Hacer clic en un elemento (selector CSS, texto, o aria-label)\n" +
          "- 'fill': Escribir texto en un campo (selector + texto)\n" +
          "- 'select': Seleccionar opción en un <select>\n" +
          "- 'get_text': Obtener todo el texto visible de la página actual\n" +
          "- 'get_html': Obtener el HTML semántico de la página\n" +
          "- 'get_links': Listar todos los enlaces de la página\n" +
          "- 'get_structure': Obtener estructura completa (encabezados, enlaces, formularios, tablas)\n" +
          "- 'scroll': Hacer scroll (down, up, toElement)\n" +
          "- 'wait': Esperar X milisegundos o a que un selector aparezca\n" +
          "- 'screenshot': Tomar captura de pantalla (guardada en archivo)\n" +
          "- 'login': Navegar a URL, llenar identificador/clave de acceso y hacer clic en botón de login\n" +
          "- 'extract_lessons': Extraer contenido estructurado de lecciones/cursos\n" +
          "- 'close': Cerrar el navegador\n" +
          "- 'status': Verificar estado del navegador",
      },
      url: {
        type: "string",
        description:
          "URL para navegar (usado con action='navigate' y 'login'). " +
          "Ej: 'https://learningchess.net/login'",
      },
      selector: {
        type: "string",
        description:
          "Selector CSS para identificar un elemento (usado con click, fill, select). " +
          "Ej: '#user_id', '[name=\"email\"]', 'button:has-text(\"Iniciar\")', " +
          "'a[href*=\"leccion\"]'",
      },
      text: {
        type: "string",
        description:
          "Texto a escribir en un campo (usado con action='fill'). " +
          "Ej: 'mi_usuario'",
      },
      value: {
        type: "string",
        description:
          "Valor a seleccionar (usado con action='select'). " +
          "Ej: 'opcion-1'",
      },
      user_id: {
        type: "string",
        description:
          "Identificador de acceso para login (usado con action='login').",
      },
      access_key: {
        type: "string",
        description:
          "Clave de acceso para login (usado con action='login').",
      },
      loginButton: {
        type: "string",
        description:
          "(Opcional) Selector del botón de login (usado con action='login'). " +
          "Por defecto busca 'button[type=\"submit\"]', 'input[type=\"submit\"]'",
      },
      user_id_field: {
        type: "string",
        description:
          "(Opcional) Selector del campo de identificador (usado con action='login'). " +
          "Por defecto detecta automáticamente campos con name=username/email/login",
      },
      access_key_field: {
        type: "string",
        description:
          "(Opcional) Selector del campo de clave de acceso (usado con action='login'). " +
          "Por defecto detecta input[type=password]",
      },
      scrollAmount: {
        type: "number",
        description:
          "(Opcional) Cantidad de píxeles para scrollear. " +
          "Usado con action='scroll' y direction='down'/'up'. Por defecto: 500",
      },
      scrollDirection: {
        type: "string",
        enum: ["down", "up", "toElement"],
        description:
          "Dirección del scroll (usado con action='scroll'). " +
          "'toElement' requiere selector para encontrar el elemento destino.",
      },
      waitMs: {
        type: "number",
        description:
          "Milisegundos a esperar (usado con action='wait'). Por defecto: 2000.",
      },
      waitSelector: {
        type: "string",
        description:
          "Selector a esperar (usado con action='wait'). " +
          "Espera hasta que el elemento sea visible.",
      },
      extractMode: {
        type: "string",
        enum: ["full", "links", "text"],
        description:
          "(Usado con action='extract_lessons') Modo de extracción:\n" +
          "- 'full': Toda la estructura de la página\n" +
          "- 'links': Solo enlaces que parezcan lecciones/cursos\n" +
          "- 'text': Solo el texto visible",
      },
      outputFile: {
        type: "string",
        description:
          "(Opcional) Ruta de archivo para guardar el resultado (JSON o TXT). " +
          "Ej: './exploracion_learningchess.json'",
      },
    },
    required: ["action"],
  },

  handler: async (args) => {
    const {
      action,
      url,
      selector,
      text,
      value,
      user_id,
      access_key,
      loginButton,
      user_id_field,
      access_key_field,
      scrollAmount,
      scrollDirection,
      waitMs,
      waitSelector,
      extractMode,
      outputFile,
    } = args;

    switch (action) {
      // ─── Navigate ──────────────────────────────────────────────────────
      case "navigate": {
        if (!url) {
          return { success: false, error: "Se requiere 'url' para navegar." };
        }
        await ensureBrowser();
        try {
          const response = await __page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          // Wait a bit for dynamic content to render
          await __page.waitForTimeout(2000);

          const snapshot = await getPageSnapshot(__page);
          return {
            success: true,
            message: `Navegado a: ${url}`,
            status: response ? response.status() : null,
            ...snapshot,
          };
        } catch (err) {
          return {
            success: false,
            error: `Error navegando a ${url}: ${err.message}`,
          };
        }
      }

      // ─── Click ─────────────────────────────────────────────────────────
      case "click": {
        if (!selector) {
          return { success: false, error: "Se requiere 'selector' para hacer clic." };
        }
        await ensureBrowser();
        try {
          // Try multiple strategies
          let element = null;

          // Strategy 1: CSS selector
          try {
            element = await __page.waitForSelector(selector, { timeout: 5000 });
          } catch { /* try next */ }

          // Strategy 2: Text content
          if (!element) {
            try {
              element = await __page.locator(`text=${selector}`).first().elementHandle({ timeout: 3000 });
            } catch { /* try next */ }
          }

          // Strategy 3: aria-label
          if (!element) {
            try {
              element = await __page.locator(`[aria-label="${selector}"]`).first().elementHandle({ timeout: 3000 });
            } catch { /* try next */ }
          }

          // Strategy 4: Partial text match in buttons/links
          if (!element) {
            try {
              element = await __page.locator(`a:has-text("${selector}"), button:has-text("${selector}")`).first().elementHandle({ timeout: 3000 });
            } catch { /* try next */ }
          }

          if (!element) {
            return {
              success: false,
              error: `No se encontró elemento con selector: "${selector}". Usa get_structure para ver los elementos disponibles.`,
              availableSelectors: await getAvailableSelectors(__page),
            };
          }

          await element.scrollIntoViewIfNeeded();
          await element.click();
          await __page.waitForTimeout(1500);

          const snapshot = await getPageSnapshot(__page);
          return {
            success: true,
            message: `Clic ejecutado en: "${selector}"`,
            ...snapshot,
          };
        } catch (err) {
          return {
            success: false,
            error: `Error al hacer clic en "${selector}": ${err.message}`,
          };
        }
      }

      // ─── Fill ──────────────────────────────────────────────────────────
      case "fill": {
        if (!selector) {
          return { success: false, error: "Se requiere 'selector' para llenar campo." };
        }
        if (text === undefined || text === null) {
          return { success: false, error: "Se requiere 'text' para llenar campo." };
        }
        await ensureBrowser();
        try {
          await __page.fill(selector, String(text));
          await __page.waitForTimeout(500);
          return {
            success: true,
            message: `Campo "${selector}" llenado.`,
          };
        } catch (err) {
          // Fallback: type character by character
          try {
            const el = await __page.$(selector);
            if (el) {
              await el.click();
              await el.fill(String(text));
              return {
                success: true,
                message: `Campo "${selector}" llenado (fallback).`,
              };
            }
          } catch { /* fallthrough */ }
          return {
            success: false,
            error: `Error llenando campo "${selector}": ${err.message}`,
          };
        }
      }

      // ─── Select ────────────────────────────────────────────────────────
      case "select": {
        if (!selector) {
          return { success: false, error: "Se requiere 'selector' para seleccionar." };
        }
        if (!value) {
          return { success: false, error: "Se requiere 'value' para seleccionar." };
        }
        await ensureBrowser();
        try {
          await __page.selectOption(selector, value);
          await __page.waitForTimeout(500);
          return {
            success: true,
            message: `Opción "${value}" seleccionada en "${selector}".`,
          };
        } catch (err) {
          return {
            success: false,
            error: `Error seleccionando en "${selector}": ${err.message}`,
          };
        }
      }

      // ─── Get Text ──────────────────────────────────────────────────────
      case "get_text": {
        await ensureBrowser();
        try {
          let pageText = "";
          try {
            pageText = await __page.evaluate(() => {
              const clone = document.body.cloneNode(true);
              const removals = clone.querySelectorAll("script, style, noscript, svg, [aria-hidden=true], [hidden], .hidden");
              removals.forEach((el) => el.remove());
              return clone.innerText || "";
            });
          } catch { /* ignore */ }

          // Truncate
          if (pageText.length > 50000) {
            pageText = pageText.slice(0, 50000) +
              `\n\n[... ${pageText.length - 50000} caracteres más ...]`;
          }

          return {
            success: true,
            url: __page.url(),
            title: await __page.title(),
            textContent: pageText,
            charCount: pageText.length,
          };
        } catch (err) {
          // If browser not initialized
          if (!__browser || !__browser.isConnected()) {
            return { success: false, error: "Navegador no iniciado. Usa 'navigate' primero." };
          }
          return {
            success: false,
            error: `Error obteniendo texto: ${err.message}`,
          };
        }
      }

      // ─── Get HTML ──────────────────────────────────────────────────────
      case "get_html": {
        await ensureBrowser();
        try {
          // Get semantic HTML (body innerHTML sanitized)
          const html = await __page.evaluate(() => {
            // Remove non-semantic elements
            const clone = document.body.cloneNode(true);
            const removals = clone.querySelectorAll("script, style, noscript, svg, [aria-hidden=true]");
            removals.forEach((el) => el.remove());
            return clone.innerHTML || "";
          });
          const truncated = html.length > 40000
            ? html.slice(0, 40000) + `\n\n[... ${html.length - 40000} chars truncated ...]`
            : html;
          return {
            success: true,
            url: __page.url(),
            title: await __page.title(),
            html: truncated,
            charCount: html.length,
          };
        } catch (err) {
          if (!__browser || !__browser.isConnected()) {
            return { success: false, error: "Navegador no iniciado. Usa 'navigate' primero." };
          }
          return {
            success: false,
            error: `Error obteniendo HTML: ${err.message}`,
          };
        }
      }

      // ─── Get Links ─────────────────────────────────────────────────────
      case "get_links": {
        await ensureBrowser();
        try {
          const links = await __page.evaluate(() => {
            return Array.from(document.querySelectorAll("a[href]"))
              .map((a) => ({
                text: (a.innerText || "").trim().slice(0, 150),
                href: a.getAttribute("href") || "",
                title: a.getAttribute("title") || "",
              }))
              .filter((l) => l.href && !l.href.startsWith("#"))
              .slice(0, 500);
          });
          return {
            success: true,
            url: __page.url(),
            title: await __page.title(),
            total: links.length,
            links,
          };
        } catch (err) {
          if (!__browser || !__browser.isConnected()) {
            return { success: false, error: "Navegador no iniciado. Usa 'navigate' primero." };
          }
          return {
            success: false,
            error: `Error obteniendo enlaces: ${err.message}`,
          };
        }
      }

      // ─── Get Structure ─────────────────────────────────────────────────
      case "get_structure": {
        await ensureBrowser();
        try {
          const snapshot = await getPageSnapshot(__page);
          return {
            success: true,
            ...snapshot,
          };
        } catch (err) {
          if (!__browser || !__browser.isConnected()) {
            return { success: false, error: "Navegador no iniciado. Usa 'navigate' primero." };
          }
          return {
            success: false,
            error: `Error obteniendo estructura: ${err.message}`,
          };
        }
      }

      // ─── Scroll ────────────────────────────────────────────────────────
      case "scroll": {
        await ensureBrowser();
        try {
          if (scrollDirection === "toElement") {
            if (!selector) {
              return { success: false, error: "Se requiere 'selector' para scroll hacia elemento." };
            }
            await __page.locator(selector).first().scrollIntoViewIfNeeded();
          } else {
            const amount = scrollAmount || 500;
            const direction = scrollDirection === "up" ? -amount : amount;
            await __page.evaluate((y) => {
              window.scrollBy(0, y);
            }, direction);
          }
          await __page.waitForTimeout(800);
          const snapshot = await getPageSnapshot(__page);
          return {
            success: true,
            message: `Scroll ${scrollDirection || "down"} ejecutado.`,
            ...snapshot,
          };
        } catch (err) {
          return {
            success: false,
            error: `Error haciendo scroll: ${err.message}`,
          };
        }
      }

      // ─── Wait ──────────────────────────────────────────────────────────
      case "wait": {
        await ensureBrowser();
        try {
          if (waitSelector) {
            await __page.waitForSelector(waitSelector, { timeout: 30000 });
            return {
              success: true,
              message: `Selector "${waitSelector}" encontrado.`,
            };
          } else {
            const ms = waitMs || 2000;
            await __page.waitForTimeout(ms);
            return {
              success: true,
              message: `Espera de ${ms}ms completada.`,
              ...(await getPageSnapshot(__page)),
            };
          }
        } catch (err) {
          return {
            success: false,
            error: `Error en wait: ${err.message}`,
          };
        }
      }

      // ─── Screenshot (debug only) ──────────────────────────────────────
      case "screenshot": {
        await ensureBrowser();
        try {
          const fileName = outputFile || `screenshot_${Date.now()}.png`;
          const filePath = path.resolve(fileName);
          await __page.screenshot({ path: filePath, fullPage: true });
          return {
            success: true,
            message: `Captura guardada en: ${filePath}`,
            note: "⚠️ DeepSeek NO puede ver imágenes. Esta captura es solo para depuración manual.",
            filePath,
          };
        } catch (err) {
          return {
            success: false,
            error: `Error tomando screenshot: ${err.message}`,
          };
        }
      }

      // ─── Login ─────────────────────────────────────────────────────────
      case "login": {
        if (!url) {
          return { success: false, error: "Se requiere 'url' para login." };
        }
        if (!user_id || !access_key) {
          return { success: false, error: "Se requieren 'user_id' y 'access_key' para login." };
        }

        await ensureBrowser();

        try {
          // 1. Navigate to login page
          await __page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await __page.waitForTimeout(2000);

          // 2. Detect and fill user_id field
          const userSel = user_id_field || await detectField(__page, ["username", "email", "user", "login", "usuario", "correo", "emailaddress"]);
          if (userSel) {
            await __page.fill(userSel, user_id);
          } else {
            return { success: false, error: "No se pudo detectar el campo de identificador.", ...(await getPageSnapshot(__page)) };
          }

          // 3. Detect and fill access_key field
          const passSel = access_key_field || "input[type='password']";
          try {
            await __page.fill(passSel, access_key);
          } catch {
            const detectedPass = await detectField(__page, ["password", "pass", "contraseña", "clave"]);
            if (detectedPass) {
              await __page.fill(detectedPass, access_key);
            } else {
              return { success: false, error: "No se pudo detectar el campo de clave de acceso.", ...(await getPageSnapshot(__page)) };
            }
          }

          await __page.waitForTimeout(500);

          // 4. Click login/submit button
          const btnSel = loginButton || "button[type='submit'], input[type='submit'], button:has-text('Iniciar'), button:has-text('Entrar'), button:has-text('Login'), button:has-text('Sign In')";
          try {
            const btn = await __page.waitForSelector(btnSel, { timeout: 5000 });
            await btn.click();
          } catch {
            // Try generic button click
            try {
              const buttons = await __page.locator("button").all();
              for (const b of buttons) {
                const text = await b.innerText();
                if (/iniciar|entrar|login|sign\s*in|acceder|submit/i.test(text)) {
                  await b.click();
                  break;
                }
              }
            } catch { /* last resort */ }
          }

          // 5. Wait for navigation after login
          await __page.waitForTimeout(3000);

          const snapshot = await getPageSnapshot(__page);
          return {
            success: true,
            message: `Login completado en: ${url}`,
            loggedIn: !snapshot.url.includes("login") && !snapshot.url.includes("auth"),
            ...snapshot,
          };
        } catch (err) {
          return {
            success: false,
            error: `Error en login: ${err.message}`,
          };
        }
      }

      // ─── Extract Lessons ───────────────────────────────────────────────
      case "extract_lessons": {
        await ensureBrowser();
        try {
          const mode = extractMode || "full";
          const result = {
            url: __page.url(),
            title: await __page.title(),
            lessons: [],
          };

          if (mode === "links") {
            // Look for lesson/course links
            const links = await __page.evaluate(() => {
              return Array.from(document.querySelectorAll("a[href]"))
                .map((a) => ({
                  text: (a.innerText || "").trim().slice(0, 200),
                  href: a.getAttribute("href") || "",
                }))
                .filter((l) => {
                  const t = l.text.toLowerCase();
                  const h = l.href.toLowerCase();
                  return (
                    t.length > 3 &&
                    !t.includes("javascript") &&
                    !h.startsWith("#") &&
                    !h.includes("logout") &&
                    !h.includes("javascript:")
                  );
                })
                .slice(0, 300);
            });
            result.lessons = links;
            result.totalLinks = links.length;
          } else {
            const snapshot = await getPageSnapshot(__page);
            // Try to identify lesson-like content (cards, list items, sections)
            const structuredContent = await __page.evaluate(() => {
              const items = [];
              // Look for common lesson/course patterns
              const containers = document.querySelectorAll(
                ".lesson, .course, .module, [class*='lesson'], [class*='course'], " +
                "[class*='chapter'], [class*='tema'], .card, .list-item, " +
                "li, article, section"
              );
              containers.forEach((el, i) => {
                const text = (el.innerText || "").trim();
                if (text.length > 10 && text.length < 5000) {
                  items.push({
                    index: i,
                    tag: el.tagName,
                    class: el.className.slice(0, 100),
                    text: text.slice(0, 500),
                    hasLink: !!el.querySelector("a"),
                    hasImage: !!el.querySelector("img"),
                  });
                }
              });
              return items.slice(0, 200);
            });
            result.pageSnapshot = snapshot;
            result.structuredContent = structuredContent;
          }

          // Save to file if requested
          if (outputFile) {
            const fs = await import("fs");
            const content = JSON.stringify(result, null, 2);
            fs.writeFileSync(outputFile, content, "utf-8");
            result.savedTo = outputFile;
          }

          return { success: true, ...result };
        } catch (err) {
          if (!__browser || !__browser.isConnected()) {
            return { success: false, error: "Navegador no iniciado. Usa 'navigate' primero." };
          }
          return {
            success: false,
            error: `Error extrayendo lecciones: ${err.message}`,
          };
        }
      }

      // ─── Close ─────────────────────────────────────────────────────────
      case "close": {
        await closeBrowser();
        return {
          success: true,
          message: "Navegador cerrado. La próxima llamada iniciará uno nuevo.",
        };
      }

      // ─── Status ────────────────────────────────────────────────────────
      case "status": {
        const isConnected = __browser && __browser.isConnected();
        return {
          success: true,
          browserOpen: !!isConnected,
          currentUrl: isConnected && __page ? __page.url() : null,
          currentTitle: isConnected && __page ? await __page.title().catch(() => null) : null,
          idleSeconds: __lastActivity ? Math.floor((Date.now() - __lastActivity) / 1000) : null,
          note: isConnected
            ? "El navegador está abierto. Puedes seguir navegando."
            : "El navegador está cerrado. Usa 'navigate' para iniciarlo.",
        };
      }

      default:
        return {
          success: false,
          error: `Acción desconocida: "${action}". ` +
            "Acciones válidas: navigate, click, fill, select, get_text, get_html, " +
            "get_links, get_structure, scroll, wait, screenshot, login, extract_lessons, close, status",
        };
    }
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Detecta un campo de formulario por posibles nombres/IDs.
 * @param {import("playwright").Page} page
 * @param {string[]} possibleNames
 * @returns {Promise<string | null>} Selector CSS
 */
async function detectField(page, possibleNames) {
  for (const name of possibleNames) {
    const selectors = [
      `#${name}`,
      `[name="${name}"]`,
      `[name="${name.toLowerCase()}"]`,
      `[name="${name.toUpperCase()}"]`,
      `input[type="text"][name*="${name}"]`,
      `input[type="email"][name*="${name}"]`,
      `input[placeholder*="${name}"]`,
      `input[placeholder*="${capitalize(name)}"]`,
      `input:not([type="hidden"]):not([type="password"])`,
    ];
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return sel;
      } catch { /* continue */ }
    }
  }
  return null;
}

/**
 * Capitaliza la primera letra.
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Obtiene selectores disponibles en la página actual (para mensajes de error útiles).
 */
async function getAvailableSelectors(page) {
  try {
    return await page.evaluate(() => {
      const items = [];
      // Buttons
      document.querySelectorAll("button, [role=button], a.btn, a.button").forEach((el) => {
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 60);
        if (text) items.push(`button "${text}"`);
      });
      // Links with text
      document.querySelectorAll("a[href]").forEach((el) => {
        const text = (el.innerText || "").trim().slice(0, 60);
        if (text && !el.href.startsWith("#")) items.push(`a "${text}" → ${el.getAttribute("href")}`);
      });
      // Inputs
      document.querySelectorAll("input:not([type=hidden])").forEach((el) => {
        const name = el.getAttribute("name") || el.getAttribute("id") || el.getAttribute("placeholder") || "";
        items.push(`input[${el.getAttribute("type") || "text"}] name="${name}"`);
      });
      return items.slice(0, 50);
    });
  } catch {
    return [];
  }
}

import path from "path";
