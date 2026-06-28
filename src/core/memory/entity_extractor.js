/**
 * Entity Extractor — Extrae entidades y relaciones del texto sin LLM.
 * Usa regex + diccionarios + FTS5. Inspirado en gbrain.
 * Activado por defecto. Toggle: LV_ENTITY_EXTRACTOR=false para desactivar.
 */
const ENTITY_PATTERNS = {
  person: [
    /([A-Z][a-záéíóúñ]+)\s+([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)?)/g, // Nombre Apellido
    /@([a-zA-Z0-9_]+)/g,  // @username
  ],
  email: [/[\w.+-]+@[\w-]+\.[\w.-]+/g],
  url: [/https?:\/\/[^\s<>"']+/g],
  company: [
    /([A-Z][a-zA-Z]+(?:Inc|Corp|Ltd|LLC|SA|GmbH|AI|Tech|Labs|Studio|Co))/g,
    /@([a-zA-Z0-9_]+)/g,
  ],
  technology: [
    /(React|Vue|Angular|Svelte|Next\.?js?|Nuxt|Node\.?js?|Python|TypeScript|JavaScript|Go|Rust|Docker|Kubernetes|PostgreSQL|MongoDB|Redis|GraphQL|REST|API|SQLite|Supabase|Firebase|AWS|GCP|Azure|Vercel|Netlify|Cloudflare|Tailwind|Sass|Prisma|tRPC|MCP|LLM|GPT|Claude|Gemini|DeepSeek|Ollama|Playwright|Cypress|Vitest|Jest)/gi,
  ],
  version: [/\b\d+\.\d+\.\d+\b/g],
  github: [/[\w-]+\/[\w-]+/g],
};

const RELATION_PATTERNS = [
  { pattern: /(\w+)\s+(trabaja|works|está|is)\s+(en|at)\s+(\w+)/gi, type: "works_at" },
  { pattern: /(\w+)\s+(fundó|founded|created|creó)\s+(\w+)/gi, type: "founded" },
  { pattern: /(\w+)\s+(invierte|invested|inversión)\s+(en|in)\s+(\w+)/gi, type: "invested_in" },
  { pattern: /(\w+)\s+(asesora|advises|mentor)\s+(a|to)\s+(\w+)/gi, type: "advises" },
  { pattern: /(\w+)\s+(usa|uses|utiliza|built|construyó)\s+(con|with|on)\s+(\w+)/gi, type: "uses" },
  { pattern: /(\w+)\s+(conoce|knows|meet|conoció)\s+(a|to)\s+(\w+)/gi, type: "knows" },
];

const TECH_DICT = ["react","vue","angular","svelte","nextjs","nuxt","node","python","typescript","javascript","go","rust","docker","kubernetes","postgresql","mongodb","redis","graphql","sqlite","supabase","firebase","aws","gcp","azure","vercel","netlify","cloudflare","tailwind","prisma","trpc","mcp","llm","gpt","claude","gemini","deepseek","ollama","playwright","cypress","vitest","jest"];

export function extractEntities(text) {
  if (!text || process.env.LV_ENTITY_EXTRACTOR === "false") return { entities: [], relations: [] };
  const entities = [], relations = [];
  const seen = new Set();

  for (const [type, patterns] of Object.entries(ENTITY_PATTERNS)) {
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const name = m[0].trim();
        if (name.length < 2 || name.length > 100) continue;
        const key = `${type}:${name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entities.push({ type, name, source: m.input.slice(Math.max(0, m.index - 40), m.index + name.length + 40) });
      }
    }
  }

  for (const { pattern, type } of RELATION_PATTERNS) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      relations.push({ type, source: m[1], target: m[3] || m[4], context: m[0] });
    }
  }

  return { entities, relations };
}

export function extractTechStack(text) {
  const found = new Set();
  const lower = text.toLowerCase();
  for (const tech of TECH_DICT) {
    if (lower.includes(tech)) found.add(tech);
  }
  return [...found];
}

export default { extractEntities, extractTechStack };
