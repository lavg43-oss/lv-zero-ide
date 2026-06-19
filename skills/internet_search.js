/**
 * internet_search — Enhanced Hybrid Search Skill (Phase 4: RAG & Memory)
 *
 * Multi-provider search engine with automatic fallback, result caching,
 * and relevance ranking.
 *
 * Provider priority order:
 *   1. Tavily (primary, requires API key)
 *   2. Google Custom Search (requires API key + CX)
 *   3. Brave Search (requires API key)
 *   4. SearXNG (self-hosted, requires SEARXNG_URL)
 *   5. DuckDuckGo (fallback, no API key needed)
 *
 * Results are cached in-memory with TTL to reduce redundant requests.
 * Results are ranked by relevance score combining keyword density,
 * source authority, recency, and domain trust.
 */

// ─── Provider Configuration ──────────────────────────────────────────────────

const PROVIDERS = {
  tavily: {
    name: 'Tavily',
    priority: 1,
    apiKey: () => process.env.TAVILY_API_KEY,
    enabled: () => !!process.env.TAVILY_API_KEY,
  },
  google: {
    name: 'Google Custom Search',
    priority: 2,
    apiKey: () => process.env.GOOGLE_API_KEY,
    cx: () => process.env.GOOGLE_CX,
    enabled: () => !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
  },
  brave: {
    name: 'Brave Search',
    priority: 3,
    apiKey: () => process.env.BRAVE_API_KEY,
    enabled: () => !!process.env.BRAVE_API_KEY,
  },
  searxng: {
    name: 'SearXNG',
    priority: 4,
    baseUrl: () => process.env.SEARXNG_URL || 'http://localhost:4000',
    enabled: () => !!process.env.SEARXNG_URL,
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    priority: 5,
    enabled: () => true, // Always available as final fallback
  },
};

// ─── Search Cache ────────────────────────────────────────────────────────────

class SearchCache {
  /**
   * @param {number} [maxSize=100] - Maximum number of cached entries
   * @param {number} [ttl=300000] - Time-to-live in ms (default: 5 minutes)
   */
  constructor(maxSize = 100, ttl = 300000) {
    this._maxSize = maxSize;
    this._ttl = ttl;
    /** @type {Map<string, {results: object, timestamp: number}>} */
    this._cache = new Map();
  }

  /**
   * Generate a cache key from the query and options.
   * @param {string} query
   * @param {object} [options]
   * @returns {string}
   */
  _makeKey(query, options = {}) {
    return `${query.toLowerCase().trim()}|${options.maxResults || 5}|${options.searchDepth || 'basic'}`;
  }

  /**
   * Get cached results for a query.
   * @param {string} query
   * @param {object} [options]
   * @returns {object|null} Cached results or null if not found/expired
   */
  get(query, options = {}) {
    const key = this._makeKey(query, options);
    const entry = this._cache.get(key);

    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this._ttl) {
      this._cache.delete(key);
      return null;
    }

    console.log(`   ↳ [SearchCache] Cache HIT for "${query.substring(0, 50)}..." (age: ${Math.round(age / 1000)}s)`);
    return entry.results;
  }

  /**
   * Store results in the cache.
   * @param {string} query
   * @param {object} results
   * @param {object} [options]
   */
  set(query, results, options = {}) {
    const key = this._makeKey(query, options);

    // Evict oldest entry if at capacity
    if (this._cache.size >= this._maxSize) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }

    this._cache.set(key, {
      results,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached entries.
   */
  clear() {
    this._cache.clear();
    console.log('   ↳ [SearchCache] Cache cleared');
  }

  /**
   * Get cache statistics.
   * @returns {{ size: number, maxSize: number, ttl: number }}
   */
  stats() {
    return {
      size: this._cache.size,
      maxSize: this._maxSize,
      ttl: this._ttl,
    };
  }
}

// ─── Result Ranking ──────────────────────────────────────────────────────────

/**
 * Domain trust scores for known authoritative sources.
 * Used in ranking to boost results from trusted domains.
 */
const DOMAIN_TRUST = {
  // Academic & Research
  'arxiv.org': 0.9,
  'scholar.google.com': 0.9,
  'ieee.org': 0.85,
  'acm.org': 0.85,
  'springer.com': 0.85,
  'nature.com': 0.9,
  'science.org': 0.9,
  'research.google': 0.85,
  'openai.com': 0.8,
  'deepmind.com': 0.8,
  'mit.edu': 0.9,
  'stanford.edu': 0.9,
  'berkeley.edu': 0.85,
  'cam.ac.uk': 0.85,
  'ox.ac.uk': 0.85,

  // Official Documentation
  'docs.microsoft.com': 0.8,
  'learn.microsoft.com': 0.8,
  'developer.mozilla.org': 0.85,
  'docs.github.com': 0.8,
  'kubernetes.io': 0.8,
  'docker.com': 0.75,
  'nodejs.org': 0.8,
  'python.org': 0.8,
  'npmjs.com': 0.75,

  // News & Media
  'reuters.com': 0.8,
  'apnews.com': 0.8,
  'bbc.com': 0.8,
  'nytimes.com': 0.75,
  'wsj.com': 0.75,
  'bloomberg.com': 0.75,
  'techcrunch.com': 0.7,
  'theverge.com': 0.7,
  'wired.com': 0.7,
  'arstechnica.com': 0.75,

  // Tech Companies
  'github.com': 0.8,
  'gitlab.com': 0.75,
  'stackoverflow.com': 0.8,
  'medium.com': 0.5,
  'dev.to': 0.6,
  'reddit.com': 0.4,
};

/**
 * Default trust score for unknown domains.
 */
const DEFAULT_DOMAIN_TRUST = 0.5;

/**
 * Extract domain from a URL.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Calculate keyword density score for a result against the query.
 * @param {string} text - The result title + content
 * @param {string} query - The search query
 * @returns {number} Score 0-1
 */
function keywordDensity(text, query) {
  const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (queryWords.length === 0) return 0;

  const textLower = text.toLowerCase();
  let matches = 0;

  for (const word of queryWords) {
    if (word.length < 3) continue; // Skip very short words
    // Count occurrences
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const count = (textLower.match(regex) || []).length;
    matches += count;
  }

  // Normalize: max expected density is ~10 matches per query word
  const maxExpected = queryWords.length * 10;
  return Math.min(matches / maxExpected, 1);
}

/**
 * Check if a result URL contains a date pattern indicating recency.
 * @param {string} url
 * @param {string} content
 * @returns {number} Recency score 0-1
 */
function recencyScore(url, content) {
  // Look for year patterns in URL or content
  const currentYear = new Date().getFullYear();
  const yearPattern = /\b(20\d{2})\b/g;
  const years = [];

  let match;
  while ((match = yearPattern.exec(url + ' ' + content)) !== null) {
    years.push(parseInt(match[1]));
  }

  if (years.length === 0) return 0.5; // Neutral score

  // Score based on how recent the latest year is
  const latestYear = Math.max(...years);
  const age = currentYear - latestYear;

  if (age <= 0) return 1.0; // Current year
  if (age === 1) return 0.9;
  if (age === 2) return 0.7;
  if (age <= 4) return 0.5;
  return 0.3;
}

/**
 * Rank search results by relevance to the query.
 *
 * Scoring factors:
 *   - Keyword density (40%)
 *   - Source authority / domain trust (25%)
 *   - Recency (20%)
 *   - Original provider score if available (15%)
 *
 * @param {Array<{title: string, url: string, content: string, score?: number}>} results
 * @param {string} query
 * @returns {Array<{title: string, url: string, content: string, score: number, relevanceScore: number}>}
 */
function rankResults(results, query) {
  if (!results || results.length === 0) return [];

  const scored = results.map((result) => {
    const title = result.title || '';
    const content = result.content || '';
    const combined = `${title} ${content}`;
    const domain = extractDomain(result.url || '');

    // Factor 1: Keyword density (40% weight)
    const kwScore = keywordDensity(combined, query);

    // Factor 2: Domain trust (25% weight)
    const trustScore = DOMAIN_TRUST[domain] || DEFAULT_DOMAIN_TRUST;

    // Factor 3: Recency (20% weight)
    const recency = recencyScore(result.url || '', content);

    // Factor 4: Original provider score if available (15% weight)
    const providerScore = result.score != null ? result.score : 0.5;

    // Composite relevance score (0-1)
    const relevanceScore =
      kwScore * 0.40 +
      trustScore * 0.25 +
      recency * 0.20 +
      providerScore * 0.15;

    return {
      title,
      url: result.url,
      content,
      score: result.score, // Original provider score
      relevanceScore: Math.round(relevanceScore * 1000) / 1000, // Round to 3 decimals
    };
  });

  // Sort by relevance score descending
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return scored;
}

// ─── Skill Definition ────────────────────────────────────────────────────────

// Global cache instance shared across all searches
const _cache = new SearchCache();

export default {
  name: "internet_search",
  description:
    "Busca información actualizada en internet. " +
    "Usa múltiples proveedores en orden de prioridad: Tavily, Google Custom Search, " +
    "Brave Search, SearXNG, DuckDuckGo (fallback automático). " +
    "Los resultados se cachean en memoria por 5 minutos y se rankean por relevancia. " +
    "Es la ÚNICA fuente de verdad externa permitida. " +
    "El agente tiene PROHIBIDO usar su memoria interna para datos sobre " +
    "herramientas, programas, hardware o información técnica. " +
    "Siempre que necesites un dato factual, usa esta herramienta.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Consulta de búsqueda. Incluye el año (2026) y el mes (mayo) " +
          "para filtrar resultados actuales. " +
          'Ejemplo: "precio NVIDIA RTX 5090 mayo 2026"',
      },
      maxResults: {
        type: "number",
        description:
          "Número máximo de resultados a retornar (1-10). Por defecto: 5.",
        default: 5,
      },
      includeAnswer: {
        type: "boolean",
        description:
          "(Solo Tavily) Si es true, intentará generar un resumen directo. Por defecto: true.",
        default: true,
      },
      searchDepth: {
        type: "string",
        enum: ["basic", "advanced"],
        description:
          '(Solo Tavily) "basic" para respuestas rápidas, "advanced" para análisis profundo. Por defecto: "basic".',
        default: "basic",
      },
      bypassCache: {
        type: "boolean",
        description:
          "Si es true, ignora la caché y fuerza una búsqueda nueva. Por defecto: false.",
        default: false,
      },
    },
    required: ["query"],
  },

  handler: async ({ query, maxResults = 5, includeAnswer = true, searchDepth = "basic", bypassCache = false }) => {
    const limit = Math.min(Math.max(1, maxResults), 10);
    const cacheOptions = { maxResults: limit, searchDepth };

    // ── Check cache first (unless bypassed) ──
    if (!bypassCache) {
      const cached = _cache.get(query, cacheOptions);
      if (cached) {
        return {
          ...cached,
          cached: true,
          note: "Resultados obtenidos de caché (TTL: 5 minutos). Usa bypassCache=true para forzar búsqueda nueva.",
        };
      }
    }

    // ── Try providers in priority order ──
    const providers = Object.entries(PROVIDERS)
      .filter(([, config]) => config.enabled())
      .sort((a, b) => a[1].priority - b[1].priority);

    let lastError = null;

    for (const [providerId, config] of providers) {
      try {
        console.log(`   ↳ Intentando búsqueda con ${config.name}...`);
        const result = await searchWithProvider(providerId, config, query, limit, includeAnswer, searchDepth);

        if (result && result.success) {
          // Rank results by relevance
          const rankedResults = rankResults(result.results || [], query);

          const response = {
            success: true,
            query,
            answer: result.answer || null,
            totalResults: rankedResults.length,
            results: rankedResults,
            source: config.name,
            timestamp: new Date().toISOString(),
            cached: false,
          };

          // Cache the response
          _cache.set(query, response, cacheOptions);

          return response;
        }

        // Provider failed — log and try next
        console.log(`   ↳ ${config.name} no devolvió resultados.`);
        lastError = result?.error || `${config.name} returned no results`;
      } catch (err) {
        console.log(`   ↳ Error con ${config.name}: ${err.message}. Probando siguiente proveedor...`);
        lastError = err.message;
      }
    }

    // ── All providers failed ──
    return {
      success: false,
      error: `Todos los proveedores de búsqueda fallaron. Último error: ${lastError}`,
      query,
      note: "No tengo suficiente información. No se puede verificar este dato.",
      source: null,
      results: [],
      totalResults: 0,
      timestamp: new Date().toISOString(),
    };
  },
};

// ─── Provider Dispatcher ─────────────────────────────────────────────────────

/**
 * Route a search request to the appropriate provider implementation.
 *
 * @param {string} providerId - Provider identifier
 * @param {object} config - Provider configuration
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @param {boolean} includeAnswer - Whether to include an answer summary
 * @param {string} searchDepth - Search depth (basic/advanced)
 * @returns {Promise<object>} Search result object
 */
async function searchWithProvider(providerId, config, query, limit, includeAnswer, searchDepth) {
  switch (providerId) {
    case 'tavily':
      return searchWithTavily(query, config.apiKey(), limit, includeAnswer, searchDepth);
    case 'google':
      return searchWithGoogle(query, config.apiKey(), config.cx(), limit);
    case 'brave':
      return searchWithBrave(query, config.apiKey(), limit);
    case 'searxng':
      return searchWithSearXNG(query, config.baseUrl(), limit);
    case 'duckduckgo':
      return searchWithDuckDuckGo(query, limit);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

// ─── Tavily Searcher ─────────────────────────────────────────────────────────

async function searchWithTavily(query, apiKey, maxResults, includeAnswer, searchDepth) {
  const { tavily } = await import("@tavily/core");
  const client = tavily({ apiKey });

  const response = await client.search(query, {
    searchDepth,
    maxResults,
    includeAnswer,
  });

  const results = (response.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));

  return {
    success: true,
    query,
    answer: response.answer || null,
    totalResults: response.results?.length || 0,
    results,
  };
}

// ─── Google Custom Search ────────────────────────────────────────────────────

async function searchWithGoogle(query, apiKey, cx, maxResults) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    return {
      success: true,
      query,
      answer: data.searchInformation?.formattedTotalResults
        ? `Total results: ${data.searchInformation.formattedTotalResults}`
        : null,
      totalResults: 0,
      results: [],
    };
  }

  const results = data.items.map((item) => ({
    title: item.title,
    url: item.link,
    content: item.snippet || '',
    score: null,
  }));

  return {
    success: true,
    query,
    answer: null,
    totalResults: results.length,
    results,
  };
}

// ─── Brave Search ────────────────────────────────────────────────────────────

async function searchWithBrave(query, apiKey, maxResults) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brave API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  const results = (data.web?.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    content: item.description || '',
    score: item.age ? 0.7 : 0.5, // Slight boost for results with age info
  }));

  return {
    success: true,
    query,
    answer: data.query?.original || null,
    totalResults: results.length,
    results,
  };
}

// ─── SearXNG Searcher ────────────────────────────────────────────────────────

async function searchWithSearXNG(query, baseUrl, maxResults) {
  // SearXNG JSON API endpoint
  const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&language=en&categories=general&pageno=1`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SearXNG error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  const results = (data.results || []).slice(0, maxResults).map((item) => ({
    title: item.title,
    url: item.url,
    content: item.content || item.snippet || '',
    score: item.score || null,
  }));

  return {
    success: true,
    query,
    answer: data.answers?.[0] || null,
    totalResults: results.length,
    results,
  };
}

// ─── DuckDuckGo Searcher (Sovereign Fallback) ────────────────────────────────
// Uses duckduckgo.com/html/ — the simple HTML version that does NOT require
// VQD tokens or suffer from the JS challenge on links.duckduckgo.com/d.js.
// Slower than the API but works without any authentication.

async function searchWithDuckDuckGo(query, maxResults) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    },
  });

  const html = await response.text();

  // Split by result blocks
  const blocks = html.split('class="result results_links results_links_deep');

  if (blocks.length <= 1) {
    return {
      success: true,
      query,
      answer: null,
      totalResults: 0,
      results: [],
      note: "DuckDuckGo no encontró resultados para esta consulta.",
    };
  }

  const results = [];
  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    // Extract title
    const titleMatch = block.match(/class="result__a"[^>]*>(.*?)<\/a>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]*>/g, "").trim()
      : "(sin título)";

    // Extract URL from uddg parameter
    const urlMatch = block.match(/uddg=([^"&]+)/);
    const urlDecoded = urlMatch ? decodeURIComponent(urlMatch[1]) : null;

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet[^"]*"[^>]*>(.*?)<\//);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, "").trim()
      : "";

    if (urlDecoded) {
      results.push({
        title,
        url: urlDecoded,
        content: snippet,
        score: null,
      });
    }
  }

  return {
    success: true,
    query,
    answer: null,
    totalResults: results.length,
    results,
    note: "Resultados obtenidos vía DuckDuckGo HTML (respaldo automático, sin API key). Sin resumen automático.",
  };
}
