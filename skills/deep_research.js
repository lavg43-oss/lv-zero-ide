/**
 * deep_research — Multi-Step Deep Research Pipeline
 *
 * v1.0 — June 2026
 *
 * Performs multi-step research:
 *   1. Generates search queries covering different angles of a topic
 *   2. Executes searches via internet_search skill
 *   3. Fetches full page content via web_navigator or direct HTTP
 *   4. Deduplicates and ranks findings by relevance
 *   5. Synthesizes into a structured markdown report with citations
 *
 * Depth levels:
 *   - quick:    1 round, 2-3 queries, 3 sources
 *   - standard: 2 rounds, 3-5 queries, 5 sources
 *   - deep:     3 rounds, 5-8 queries, 10 sources
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Constants ───────────────────────────────────────────────────────────────

const DEPTH_CONFIG = {
  quick: {
    queries: { min: 2, max: 3 },
    sources: 3,
    rounds: 1,
    label: "Quick",
  },
  standard: {
    queries: { min: 3, max: 5 },
    sources: 5,
    rounds: 2,
    label: "Standard",
  },
  deep: {
    queries: { min: 5, max: 8 },
    sources: 10,
    rounds: 3,
    label: "Deep",
  },
};

const RESEARCH_CACHE_DIR = path.join(PROJECT_ROOT, ".lv-zero", "research-cache");
const REPORT_DIR = path.join(PROJECT_ROOT, "research-reports");

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * Simple file-based cache for search results and fetched content.
 * Cache key is SHA256 of the query string.
 * TTL: 1 hour for search results, 24 hours for fetched content.
 */
const cache = {
  _ensureDir() {
    if (!fs.existsSync(RESEARCH_CACHE_DIR)) {
      fs.mkdirSync(RESEARCH_CACHE_DIR, { recursive: true });
    }
  },

  _key(str) {
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
  },

  _path(key, type) {
    return path.join(RESEARCH_CACHE_DIR, `${type}-${key}.json`);
  },

  get(query, type = "search") {
    this._ensureDir();
    const key = this._key(query);
    const filePath = this._path(key, type);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const ttl = type === "search" ? 3600000 : 86400000; // 1h / 24h
        if (Date.now() - data.timestamp < ttl) {
          return data.value;
        }
        // Expired — remove stale file
        fs.unlinkSync(filePath);
      }
    } catch {
      // Corrupt cache — ignore
    }
    return null;
  },

  set(query, value, type = "search") {
    this._ensureDir();
    const key = this._key(query);
    const filePath = this._path(key, type);
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify({ timestamp: Date.now(), value }),
        "utf-8"
      );
    } catch {
      // Cache write failure is non-critical
    }
  },
};

// ─── Progress Emitter ────────────────────────────────────────────────────────

/**
 * Emits progress events so the UI can show research progress.
 * If no emitter is provided, uses console.log as fallback.
 */
function createProgressEmitter(emitter) {
  return {
    emit(stage, detail = {}) {
      const message = {
        type: "research_progress",
        stage,
        ...detail,
        timestamp: new Date().toISOString(),
      };
      if (emitter && typeof emitter.emit === "function") {
        emitter.emit("research_progress", message);
      }
      // Always log to console for CLI visibility
      const stageLabels = {
        planning: "🧠 Planning research",
        searching: "🔍 Searching",
        fetching: "📄 Fetching content",
        deduplicating: "🔗 Deduplicating findings",
        synthesizing: "📊 Synthesizing results",
        generating: "📝 Generating report",
        complete: "✅ Research complete",
        error: "❌ Error",
      };
      const label = stageLabels[stage] || stage;
      const extra = detail.query
        ? `: "${detail.query}"`
        : detail.source
          ? `: ${detail.source}`
          : detail.message
            ? `: ${detail.message}`
            : "";
      console.log(`   [research] ${label}${extra}`);
    },
  };
}

// ─── Rate Limiter Integration ────────────────────────────────────────────────

/**
 * Acquires a rate limiter token for a given bucket.
 * If no rate limiter is provided, always proceeds.
 */
async function acquireToken(rateLimiter, bucket = "search", tokens = 1) {
  if (rateLimiter && typeof rateLimiter.consume === "function") {
    return await rateLimiter.consume(bucket, tokens);
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Internal Functions
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generates search queries covering different aspects of the research topic.
 *
 * Uses the orchestrator's LLM if available; otherwise falls back to
 * template-based query generation.
 *
 * @param {string} query - The research question or topic
 * @param {string} depth - "quick", "standard", or "deep"
 * @param {object} [options]
 * @param {object} [options.llm] - LLM client for query generation
 * @param {object} [options.progress] - Progress emitter
 * @returns {Promise<Array<{query: string, rationale: string, priority: number}>>}
 */
async function planResearch(query, depth, options = {}) {
  const { llm, progress } = options;
  const config = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;
  const numQueries = Math.min(
    config.queries.max,
    Math.max(
      config.queries.min,
      Math.floor((config.queries.min + config.queries.max) / 2)
    )
  );

  if (progress) progress.emit("planning", { query, depth, numQueries });

  // ── Attempt 1: Use LLM for intelligent query generation ──
  if (llm && typeof llm.send === "function") {
    try {
      return await generateQueriesWithLLM(query, numQueries, llm);
    } catch (err) {
      console.log(
        `   ↳ LLM query generation failed: ${err.message}. Using template fallback.`
      );
    }
  }

  // ── Attempt 2: Template-based fallback ──
  return generateQueriesTemplate(query, numQueries);
}

/**
 * Uses the LLM to generate diverse search queries covering different angles.
 */
async function generateQueriesWithLLM(query, numQueries, llm) {
  const prompt = `You are a research planning assistant. Given a research topic, generate ${numQueries} diverse search queries that cover different aspects of the topic.

Research topic: "${query}"

For each query, provide:
1. The search query itself (concise, includes relevant keywords)
2. A brief rationale explaining what angle this query covers
3. A priority score (1-10, higher = more important)

Respond with a JSON array only, no markdown formatting:
[
  {
    "query": "search query string",
    "rationale": "why this query is useful",
    "priority": 8
  }
]`;

  const response = await llm.send(prompt, {
    system:
      "You are a research planning assistant. Generate diverse search queries. Respond ONLY with valid JSON array.",
    temperature: 0.7,
    maxTokens: 2000,
  });

  const text =
    typeof response === "string"
      ? response
      : response.content || response.text || "";

  // Extract JSON array from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const queries = JSON.parse(jsonMatch[0]);
      if (Array.isArray(queries) && queries.length > 0) {
        return queries
          .filter((q) => q.query && q.query.trim())
          .slice(0, numQueries)
          .map((q) => ({
            query: q.query.trim(),
            rationale: q.rationale || `Research angle for "${query}"`,
            priority: Math.min(10, Math.max(1, q.priority || 5)),
          }));
      }
    } catch {
      // Parse failed — fall through to template
    }
  }

  throw new Error("LLM response did not contain valid query array");
}

/**
 * Template-based query generation when LLM is unavailable.
 * Generates queries by combining the topic with common research angles.
 */
function generateQueriesTemplate(query, numQueries) {
  const angles = [
    { suffix: "", priority: 10 },
    { suffix: " overview and key concepts", priority: 9 },
    { suffix: " latest developments 2026", priority: 8 },
    { suffix: " benefits and advantages", priority: 7 },
    { suffix: " challenges and limitations", priority: 7 },
    { suffix: " comparison with alternatives", priority: 6 },
    { suffix: " best practices and implementation", priority: 6 },
    { suffix: " future trends and predictions", priority: 5 },
    { suffix: " case studies and examples", priority: 5 },
    { suffix: " expert opinions and analysis", priority: 4 },
  ];

  return angles.slice(0, numQueries).map((angle, i) => ({
    query: `${query}${angle.suffix}`.trim(),
    rationale:
      i === 0
        ? `Core search for "${query}"`
        : `Exploring ${angle.suffix.replace(" and ", " & ").trim()} of "${query}"`,
    priority: angle.priority,
  }));
}

/**
 * Executes research by searching for each query and fetching content.
 *
 * @param {Array<{query: string, rationale: string, priority: number}>} queries
 * @param {object} [options]
 * @param {number} [options.maxSources=5] - Max sources per depth
 * @param {object} [options.progress] - Progress emitter
 * @param {object} [options.rateLimiter] - Rate limiter instance
 * @returns {Promise<Array<{query: string, source: {url: string, title: string, snippet: string}, content: string, relevance: number}>>}
 */
async function executeResearch(queries, options = {}) {
  const { maxSources = 5, progress, rateLimiter } = options;
  const findings = [];

  for (let i = 0; i < queries.length; i++) {
    const { query, rationale, priority } = queries[i];

    if (progress)
      progress.emit("searching", {
        query,
        index: i + 1,
        total: queries.length,
      });

    // ── Step 1: Search ──
    const searchResults = await executeSearch(query, { rateLimiter });

    if (!searchResults || searchResults.length === 0) {
      console.log(`   ↳ No results for: "${query}"`);
      continue;
    }

    // ── Step 2: Fetch content for top results ──
    const sourcesPerQuery = Math.max(
      1,
      Math.ceil(maxSources / queries.length)
    );
    const topResults = searchResults.slice(0, sourcesPerQuery);

    for (let j = 0; j < topResults.length; j++) {
      const result = topResults[j];

      if (progress)
        progress.emit("fetching", {
          source: result.url,
          title: result.title,
          index: j + 1,
          total: topResults.length,
        });

      // Check cache first
      const cacheKey = `content:${result.url}`;
      let content = cache.get(cacheKey, "content");

      if (!content) {
        content = await fetchPageContent(result.url, { rateLimiter });
        if (content) {
          cache.set(cacheKey, content, "content");
        }
      }

      findings.push({
        query,
        source: {
          url: result.url,
          title: result.title || extractTitleFromUrl(result.url),
          snippet: result.snippet || result.content || "",
        },
        content: content || result.content || result.snippet || "",
        relevance: priority * (1 - j * 0.15), // Higher priority + earlier results = more relevant
      });
    }

    // Small delay between queries to be polite
    if (i < queries.length - 1) {
      await sleep(500);
    }
  }

  return findings;
}

/**
 * Executes a single search query using the internet_search skill.
 * Falls back to direct HTTP fetch if the skill is unavailable.
 */
async function executeSearch(query, { rateLimiter } = {}) {
  // Try to use the internet_search skill
  try {
    const internetSearch = await loadSkill("internet_search");
    if (internetSearch) {
      await acquireToken(rateLimiter, "search");
      const result = await internetSearch.handler({
        query,
        maxResults: 8,
        includeAnswer: false,
        searchDepth: "basic",
      });

      if (result && result.success && result.results) {
        return result.results.map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.content || "",
          content: r.content || "",
        }));
      }
    }
  } catch (err) {
    console.log(`   ↳ internet_search skill failed: ${err.message}`);
  }

  // Fallback: direct DuckDuckGo HTML search
  try {
    await acquireToken(rateLimiter, "search");
    return await duckDuckGoSearch(query);
  } catch (err) {
    console.log(`   ↳ DuckDuckGo fallback failed: ${err.message}`);
    return [];
  }
}

/**
 * Direct DuckDuckGo HTML search (same approach as internet_search fallback).
 */
async function duckDuckGoSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const html = await response.text();
  const blocks = html.split('class="result results_links results_links_deep');
  const results = [];

  for (let i = 1; i < blocks.length && results.length < 8; i++) {
    const block = blocks[i];

    const titleMatch = block.match(/class="result__a"[^>]*>(.*?)<\/a>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]*>/g, "").trim()
      : "";

    const urlMatch = block.match(/uddg=([^"&]+)/);
    const urlDecoded = urlMatch ? decodeURIComponent(urlMatch[1]) : null;

    const snippetMatch = block.match(
      /class="result__snippet[^"]*"[^>]*>(.*?)<\//
    );
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, "").trim()
      : "";

    if (urlDecoded) {
      results.push({
        url: urlDecoded,
        title,
        snippet,
        content: snippet,
      });
    }
  }

  return results;
}

/**
 * Fetches full page content using web_navigator or direct HTTP fetch.
 */
async function fetchPageContent(url, { rateLimiter } = {}) {
  // Try web_navigator first (handles JS-rendered pages)
  try {
    const webNav = await loadSkill("web_navigator");
    if (webNav) {
      await acquireToken(rateLimiter, "api");
      const result = await webNav.handler({
        action: "navigate",
        url,
      });

      if (result && result.success && result.textContent) {
        // Clean up the text
        return cleanContent(result.textContent);
      }
    }
  } catch (err) {
    console.log(`   ↳ web_navigator failed for ${url}: ${err.message}`);
  }

  // Fallback: direct HTTP fetch
  try {
    await acquireToken(rateLimiter, "api");
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Strip HTML tags and extract meaningful text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[^;]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleanContent(text);
  } catch (err) {
    console.log(`   ↳ HTTP fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Cleans extracted content: removes boilerplate, truncates reasonably.
 */
function cleanContent(text) {
  if (!text) return "";

  let cleaned = text
    // Remove common boilerplate
    .replace(/cookie|cookies|privacy policy|accept all|consent/gi, "")
    // Remove navigation-like text patterns
    .replace(
      /(home|about|contact|sign in|sign up|login|register|subscribe|follow us)/gi,
      ""
    )
    // Normalize whitespace
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // Truncate to reasonable length (50KB max per page)
  if (cleaned.length > 50000) {
    cleaned = cleaned.slice(0, 50000) + "\n\n[...content truncated...]";
  }

  return cleaned;
}

/**
 * Extracts a readable title from a URL when no title is available.
 */
function extractTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/\/$/, "")
      .split("/")
      .pop()
      .replace(/[-_]/g, " ")
      .replace(/\.\w+$/, "");
    return path.charAt(0).toUpperCase() + path.slice(1) || parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Synthesizes findings: deduplicates, ranks by relevance, groups by subtopic.
 *
 * @param {Array<{query: string, source: {url: string, title: string, snippet: string}, content: string, relevance: number}>} findings
 * @param {string} originalQuery - The original research question
 * @param {object} [options]
 * @param {object} [options.llm] - LLM client for synthesis
 * @param {object} [options.progress] - Progress emitter
 * @returns {Promise<{deduplicated: Array, groups: Array, stats: object}>}
 */
async function synthesizeResults(findings, originalQuery, options = {}) {
  const { llm, progress } = options;

  if (progress) progress.emit("deduplicating", { total: findings.length });

  // ── Step 1: Deduplicate by URL ──
  const seen = new Set();
  const deduplicated = [];

  for (const finding of findings) {
    const key = finding.source.url;
    if (seen.has(key)) continue;
    seen.add(key);

    // If we already have a finding with very similar content, keep the one
    // with higher relevance
    const similar = deduplicated.findIndex(
      (f) =>
        f.source.url !== key &&
        contentSimilarity(f.content, finding.content) > 0.7
    );

    if (similar >= 0) {
      // Keep the one with higher relevance
      if (finding.relevance > deduplicated[similar].relevance) {
        deduplicated[similar] = finding;
      }
    } else {
      deduplicated.push(finding);
    }
  }

  // ── Step 2: Rank by relevance ──
  deduplicated.sort((a, b) => b.relevance - a.relevance);

  // ── Step 3: Group by subtopic ──
  if (progress) progress.emit("synthesizing", { total: deduplicated.length });

  let groups;
  if (llm && typeof llm.send === "function") {
    try {
      groups = await groupWithLLM(deduplicated, originalQuery, llm);
    } catch {
      groups = groupByQuery(deduplicated);
    }
  } else {
    groups = groupByQuery(deduplicated);
  }

  return {
    deduplicated,
    groups,
    stats: {
      totalFindings: findings.length,
      uniqueSources: deduplicated.length,
      duplicatesRemoved: findings.length - deduplicated.length,
      groupsCount: groups.length,
    },
  };
}

/**
 * Uses LLM to intelligently group findings into subtopics.
 */
async function groupWithLLM(findings, originalQuery, llm) {
  const summaries = findings.map(
    (f, i) =>
      `[${i + 1}] Title: ${f.source.title}\nURL: ${f.source.url}\nSnippet: ${(f.content || f.source.snippet).slice(0, 500)}`
  );

  const prompt = `Given these research findings about "${originalQuery}", group them into 2-5 coherent subtopics/themes.

Findings:
${summaries.join("\n\n")}

Respond with a JSON array only:
[
  {
    "topic": "Subtopic name",
    "summary": "Brief summary of this subtopic",
    "indices": [1, 3, 5]
  }
]

The indices are 1-based numbers referencing the findings above. Each finding should appear in exactly one group.`;

  const response = await llm.send(prompt, {
    system:
      "You are a research synthesis assistant. Group findings into coherent subtopics. Respond ONLY with valid JSON array.",
    temperature: 0.3,
    maxTokens: 3000,
  });

  const text =
    typeof response === "string"
      ? response
      : response.content || response.text || "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const groups = JSON.parse(jsonMatch[0]);
      if (Array.isArray(groups) && groups.length > 0) {
        return groups.map((g) => ({
          topic: g.topic || "General",
          summary: g.summary || "",
          findings: (g.indices || [])
            .map((i) => findings[i - 1])
            .filter(Boolean),
        }));
      }
    } catch {
      // Fall through to query-based grouping
    }
  }

  throw new Error("LLM grouping failed");
}

/**
 * Groups findings by their originating query as a simple fallback.
 */
function groupByQuery(findings) {
  const queryMap = new Map();

  for (const finding of findings) {
    const key = finding.query;
    if (!queryMap.has(key)) {
      queryMap.set(key, {
        topic: key,
        summary: `Findings related to "${key}"`,
        findings: [],
      });
    }
    queryMap.get(key).findings.push(finding);
  }

  return Array.from(queryMap.values());
}

/**
 * Computes a simple content similarity score (0-1) between two text strings.
 * Uses Jaccard similarity on word sets.
 */
function contentSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Report Generation
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generates a well-formatted markdown research report.
 *
 * @param {object} synthesis - Result from synthesizeResults()
 * @param {string} originalQuery - The original research question
 * @param {string} depth - Research depth level
 * @param {object} [options]
 * @param {object} [options.progress] - Progress emitter
 * @returns {string} - Markdown report content
 */
function generateMarkdownReport(synthesis, originalQuery, depth, options = {}) {
  const { progress } = options;
  if (progress) progress.emit("generating", { format: "markdown" });

  const { deduplicated, groups, stats } = synthesis;
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const depthLabel = DEPTH_CONFIG[depth]?.label || "Standard";

  // Build sources list (deduplicated by URL)
  const sources = [];
  const sourceUrls = new Set();
  for (const finding of deduplicated) {
    if (!sourceUrls.has(finding.source.url)) {
      sourceUrls.add(finding.source.url);
      sources.push(finding.source);
    }
  }

  let report = `# Research Report: ${originalQuery}

**Date**: ${date}
**Depth**: ${depthLabel}
**Sources consulted**: ${sources.length}
**Unique findings**: ${stats.uniqueSources}

---

## Executive Summary

This research report synthesizes information from ${sources.length} sources on the topic of "${originalQuery}". The findings are organized into ${groups.length} key thematic areas.

${groups
  .map(
    (g) =>
      `**${g.topic}**: ${g.summary || `${g.findings.length} relevant source(s) examined.`}`
  )
  .join("\n")}

---

## Key Findings

`;

  // Generate findings per group
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    report += `### ${gi + 1}. ${group.topic}\n\n`;

    if (group.summary) {
      report += `${group.summary}\n\n`;
    }

    for (const finding of group.findings) {
      const sourceIndex =
        sources.findIndex((s) => s.url === finding.source.url) + 1;
      const content = extractRelevantContent(
        finding.content,
        originalQuery,
        800
      );

      report += `${content}\n\n`;
      report += `  — *[Source ${sourceIndex}]*\n\n`;
    }
  }

  // ── Sources section ──
  report += `---

## Sources

`;

  sources.forEach((source, i) => {
    report += `${i + 1}. **[${source.title}](${source.url})**`;
    if (source.snippet) {
      report += ` — ${source.snippet.slice(0, 150)}`;
    }
    report += `\n`;
  });

  report += `\n---

*Report generated on ${date} using lv-zero Deep Research (${depthLabel} mode).*\n`;

  return report;
}

/**
 * Generates a structured JSON research report.
 *
 * @param {object} synthesis - Result from synthesizeResults()
 * @param {string} originalQuery - The original research question
 * @param {string} depth - Research depth level
 * @returns {object} - Structured JSON report
 */
function generateJsonReport(synthesis, originalQuery, depth) {
  const { deduplicated, groups, stats } = synthesis;
  const depthLabel = DEPTH_CONFIG[depth]?.label || "Standard";

  // Build sources list
  const sources = [];
  const sourceUrls = new Set();
  for (const finding of deduplicated) {
    if (!sourceUrls.has(finding.source.url)) {
      sourceUrls.add(finding.source.url);
      sources.push({
        id: sources.length + 1,
        title: finding.source.title,
        url: finding.source.url,
        snippet: finding.source.snippet,
      });
    }
  }

  return {
    metadata: {
      topic: originalQuery,
      generatedAt: new Date().toISOString(),
      depth: depthLabel,
      sourcesConsulted: sources.length,
      uniqueFindings: stats.uniqueSources,
      duplicatesRemoved: stats.duplicatesRemoved,
    },
    executiveSummary: `Research report synthesizing information from ${sources.length} sources on "${originalQuery}". Findings organized into ${groups.length} thematic areas.`,
    findings: groups.map((g) => ({
      topic: g.topic,
      summary: g.summary || "",
      sources: g.findings.map((f) => {
        const sourceId =
          sources.find((s) => s.url === f.source.url)?.id || 0;
        return {
          sourceId,
          content: extractRelevantContent(f.content, originalQuery, 500),
          relevance: f.relevance,
        };
      }),
    })),
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      snippet: s.snippet,
    })),
  };
}

/**
 * Extracts the most relevant portion of content relative to the query.
 * Simple heuristic: finds paragraphs containing query keywords.
 */
function extractRelevantContent(content, query, maxLength = 800) {
  if (!content) return "";

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Split into paragraphs
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 20);

  if (paragraphs.length === 0) return content.slice(0, maxLength);

  // Score paragraphs by keyword density
  const scored = paragraphs.map((p) => {
    const lower = p.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = lower.match(regex);
      if (matches) score += matches.length;
    }
    return { text: p, score };
  });

  // Sort by score descending, take top paragraphs up to maxLength
  scored.sort((a, b) => b.score - a.score);

  let result = "";
  for (const p of scored) {
    if (result.length + p.text.length > maxLength) {
      if (result.length === 0) {
        result = p.text.slice(0, maxLength) + "...";
      }
      break;
    }
    result += (result ? "\n\n" : "") + p.text;
  }

  return result || content.slice(0, maxLength);
}

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Dynamic import of a skill by name from the skills directory.
 * Caches the loaded skill module.
 */
const _skillCache = new Map();

async function loadSkill(name) {
  if (_skillCache.has(name)) {
    return _skillCache.get(name);
  }

  try {
    // Use URL-based import to avoid cache-busting issues with Node.js
    const modulePath = new URL(`./${name}.js`, import.meta.url).href;
    const module = await import(modulePath);
    const skill = module.default || module;
    _skillCache.set(name, skill);
    return skill;
  } catch (err) {
    console.log(`   ↳ Could not load skill "${name}": ${err.message}`);
    return null;
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Saves content to a file in the research-reports directory.
 * Returns the file path.
 */
function saveReport(content, filename) {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const filePath = path.join(REPORT_DIR, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ═════════════════════════════════════════════════════════════════════════════
// Skill Definition
// ═════════════════════════════════════════════════════════════════════════════

export default {
  name: "deep_research",
  description:
    "Multi-step deep research. Generates search queries covering different angles, " +
    "gathers information from multiple sources via web search and page fetching, " +
    "deduplicates and ranks findings, and synthesizes everything into a structured " +
    "markdown report with numbered citations and source URLs. " +
    "Supports three depth levels: quick (1 round, ~3 sources), standard (2 rounds, ~5 sources), " +
    "deep (3 rounds, ~10 sources). " +
    "Results are saved to the research-reports/ directory. " +
    "Progress events are emitted for UI display during long research runs.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The research question or topic to investigate. " +
          "Be specific for better results. " +
          'Example: "Impact of AI on software development practices in 2026"',
      },
      depth: {
        type: "string",
        enum: ["quick", "standard", "deep"],
        description:
          "Research depth:\n" +
          '- "quick": 1 round, 2-3 queries, ~3 sources. Best for fast overviews.\n' +
          '- "standard": 2 rounds, 3-5 queries, ~5 sources. Balanced depth/speed.\n' +
          '- "deep": 3 rounds, 5-8 queries, ~10 sources. Most thorough.',
      },
      format: {
        type: "string",
        enum: ["markdown", "json"],
        description:
          'Output format. "markdown" (default) generates a formatted markdown report. ' +
          '"json" generates structured JSON data.',
      },
    },
    required: ["query"],
  },

  handler: async ({
    query,
    depth = "standard",
    format = "markdown",
    emitter,
    rateLimiter,
  }) => {
    const progress = createProgressEmitter(emitter);

    try {
      // ── Phase 1: Plan ──
      progress.emit("planning", { query, depth });

      const queries = await planResearch(query, depth, {
        llm: null, // Will be injected by orchestrator if available
        progress,
      });

      progress.emit("planning", {
        message: `Generated ${queries.length} search queries`,
        queries: queries.map((q) => q.query),
      });

      // ── Phase 2: Execute ──
      const config = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;
      const findings = await executeResearch(queries, {
        maxSources: config.sources,
        progress,
        rateLimiter,
      });

      if (findings.length === 0) {
        return {
          success: false,
          error: "No results found for any of the generated queries.",
          queries: queries.map((q) => q.query),
        };
      }

      progress.emit("fetching", {
        message: `Collected ${findings.length} findings from ${queries.length} queries`,
      });

      // ── Phase 3: Synthesize ──
      const synthesis = await synthesizeResults(findings, query, {
        llm: null,
        progress,
      });

      progress.emit("synthesizing", {
        message: `Deduplicated to ${synthesis.stats.uniqueSources} unique sources across ${synthesis.stats.groupsCount} topics`,
        stats: synthesis.stats,
      });

      // ── Phase 4: Generate Report ──
      let report;
      let filename;
      let mimeType;

      if (format === "json") {
        report = generateJsonReport(synthesis, query, depth);
        const safeName = query
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .slice(0, 50);
        filename = `research_${safeName}_${Date.now()}.json`;
        mimeType = "application/json";
      } else {
        report = generateMarkdownReport(synthesis, query, depth, { progress });
        const safeName = query
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .slice(0, 50);
        filename = `research_${safeName}_${Date.now()}.md`;
        mimeType = "text/markdown";
      }

      // ── Save report to file ──
      const filePath = saveReport(
        typeof report === "string" ? report : JSON.stringify(report, null, 2),
        filename
      );

      progress.emit("complete", {
        message: `Report saved to ${filePath}`,
        filePath,
      });

      return {
        success: true,
        query,
        depth,
        format,
        report,
        filePath,
        filename,
        mimeType,
        stats: synthesis.stats,
        queries: queries.map((q) => q.query),
        sources: synthesis.deduplicated.map((f) => ({
          url: f.source.url,
          title: f.source.title,
        })),
        groups: synthesis.groups.map((g) => ({
          topic: g.topic,
          findingCount: g.findings.length,
        })),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      progress.emit("error", { message: err.message });
      return {
        success: false,
        error: `Deep research failed: ${err.message}`,
        query,
        depth,
      };
    }
  },
};