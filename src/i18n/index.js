/**
 * ─── i18n Engine for lv-zero ─────────────────────────────────────────────
 *
 * Lightweight internationalization system.
 * Supports English and Spanish with easy extension to other languages.
 *
 * Usage:
 *   import { t, setLanguage, getLanguage } from "./i18n/index.js";
 *   t("chat.title") → "AI Chat" or "Chat IA"
 *   setLanguage("es") → switches to Spanish
 *
 * v1.0 — June 2026
 *
 * @module i18n
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {string} Current language code */
let _currentLanguage = "en";

/** @type {object} Current translations */
let _translations = {};

/** @type {object} All loaded translations */
const _loadedTranslations = {};

/** @type {Function[]} Language change listeners */
const _listeners = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Translates a key using the current language.
 * Supports dot notation: t("chat.title")
 *
 * @param {string} key - Dot-notation key (e.g., "chat.title")
 * @param {object} [params] - Optional interpolation parameters
 * @returns {string} Translated string
 */
export function t(key, params = {}) {
  const value = _getNestedValue(_translations, key);
  if (value === undefined || value === null) {
    // Fallback: try English
    const enValue = _getNestedValue(_loadedTranslations["en"], key);
    if (enValue !== undefined && enValue !== null) {
      return _interpolate(String(enValue), params);
    }
    return key; // Last resort: return the key itself
  }
  return _interpolate(String(value), params);
}

/**
 * Sets the current language and notifies listeners.
 *
 * @param {string} lang - Language code ("en" or "es")
 * @returns {Promise<boolean>} Whether the language was loaded
 */
export async function setLanguage(lang) {
  if (lang === _currentLanguage && _loadedTranslations[lang]) return true;
  if (!["en", "es"].includes(lang)) return false;

  try {
    if (!_loadedTranslations[lang]) {
      const filePath = path.resolve(__dirname, `${lang}.json`);
      const raw = fs.readFileSync(filePath, "utf-8");
      _loadedTranslations[lang] = JSON.parse(raw);
    }

    _currentLanguage = lang;
    _translations = _loadedTranslations[lang] || {};

    // Notify listeners
    for (const listener of _listeners) {
      try {
        listener(lang, _translations);
      } catch {}
    }

    return true;
  } catch (err) {
    console.warn(`   ⚠️ i18n: Error loading language "${lang}": ${err.message}`);
    return false;
  }
}

/**
 * Gets the current language code.
 * @returns {string}
 */
export function getLanguage() {
  return _currentLanguage;
}

/**
 * Gets all available language codes.
 * @returns {string[]}
 */
export function getAvailableLanguages() {
  return ["en", "es"];
}

/**
 * Gets the display name for a language code.
 * @param {string} lang
 * @returns {string}
 */
export function getLanguageName(lang) {
  const names = {
    en: "English",
    es: "Español",
  };
  return names[lang] || lang;
}

/**
 * Registers a listener for language changes.
 * @param {Function} callback - Receives (lang, translations)
 * @returns {Function} Unsubscribe function
 */
export function onLanguageChanged(callback) {
  _listeners.push(callback);
  return () => {
    const idx = _listeners.indexOf(callback);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

/**
 * Pre-loads a language without switching to it.
 * @param {string} lang
 */
export async function preloadLanguage(lang) {
  if (_loadedTranslations[lang]) return;
  try {
    const filePath = path.resolve(__dirname, `${lang}.json`);
    const raw = fs.readFileSync(filePath, "utf-8");
    _loadedTranslations[lang] = JSON.parse(raw);
  } catch {}
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Gets a nested value from an object using dot notation.
 */
function _getNestedValue(obj, key) {
  if (!obj || !key) return undefined;
  const parts = key.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Interpolates parameters into a string.
 * Replaces {{key}} with the corresponding value from params.
 */
function _interpolate(str, params) {
  if (!params || Object.keys(params).length === 0) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match;
  });
}

// ─── Auto-initialize with English ─────────────────────────────────────────────

// Load English on import
setLanguage("en").catch(() => {});
