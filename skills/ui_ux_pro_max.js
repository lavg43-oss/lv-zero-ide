/**
 * UI UX Pro Max — Design Intelligence Skill for LV-ZERO
 * Adapted from: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT)
 * 
 * Actions: design_system, color_palette, typography, style_guide, chart_style
 * Data: 50+ styles, 161 color palettes, 57 font pairings, 161 product types, 99 UX guidelines, 25 chart types
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data', 'ui-ux-pro-max');

// ─── CSV Reader ───────────────────────────────────────────────
function parseCSV(filepath) {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const lines = raw.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h.trim().toLowerCase()] = values[i]?.trim() || '');
    return row;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

function searchCSV(filepath, query, limit = 10) {
  const rows = parseCSV(filepath);
  const q = query.toLowerCase();
  return rows.filter(row => 
    Object.values(row).some(v => String(v).toLowerCase().includes(q))
  ).slice(0, limit);
}

// ─── Data Loaders ─────────────────────────────────────────────
function loadColors() {
  const rows = parseCSV(path.join(DATA_DIR, 'colors.csv'));
  return rows.map(r => ({
    name: r.name || r.palette_name || '',
    colors: r.colors || r.hex || '',
    category: r.category || r.style || '',
    description: r.description || ''
  }));
}

function loadStyles() {
  const rows = parseCSV(path.join(DATA_DIR, 'styles.csv'));
  return rows.map(r => ({
    name: r['style category'] || r.name || r.style_name || '',
    description: r['best for'] || r.description || '',
    category: r['type'] || r.category || '',
    keywords: r['keywords'] || '',
    effects: r['effects & animation'] || '',
    colors: r['primary colors'] || ''
  }));
}

function loadProducts() {
  const rows = parseCSV(path.join(DATA_DIR, 'products.csv'));
  return rows.map(r => ({
    name: r['product type'] || r.name || r.product || r.product_name || '',
    category: r['product type'] || r.category || r.industry || '',
    style: r['primary style recommendation'] || r.style || r.recommended_style || '',
    secondary: r['secondary styles'] || '',
    colors: r['color palette focus'] || r.colors || r.recommended_colors || '',
    keywords: r['keywords'] || '',
    key_considerations: r['key considerations'] || ''
  }));
}

function loadTypography() {
  const rows = parseCSV(path.join(DATA_DIR, 'typography.csv'));
  return rows.map(r => ({
    name: r.name || r.pairing_name || r.font_pair || '',
    heading: r.heading || r.heading_font || '',
    body: r.body || r.body_font || '',
    style: r.style || r.category || '',
    description: r.description || ''
  }));
}

function loadUXGuidelines() {
  const rows = parseCSV(path.join(DATA_DIR, 'ux-guidelines.csv'));
  return rows.map(r => ({
    rule: r.rule || r.guideline || r.name || '',
    category: r.category || r.priority || '',
    description: r.description || r.requirement || '',
    anti_pattern: r.anti_pattern || r.anti_patterns || r.avoid || ''
  }));
}

// ─── Design System Generator ──────────────────────────────────
function generateDesignSystem(productType) {
  const products = loadProducts();
  const colors = loadColors();
  const typography = loadTypography();
  const styles = loadStyles();
  
  // Match product type
  const q = productType.toLowerCase();
  const matched = products.find(p => 
    p.name.toLowerCase().includes(q) || 
    p.category.toLowerCase().includes(q)
  );
  
  if (!matched) {
    return {
      error: `Product type "${productType}" not found. Try: education, fintech, ecommerce, healthcare, saas, gaming, restaurant`,
      hint: "Available types can be searched with action='search'"
    };
  }

  // Match style from product recommendation (e.g. "Claymorphism + Micro-interactions")
  const styleKeyword = matched.style?.split(' + ')[0]?.split(' & ')[0]?.trim() || '';
  const style = styles.find(s => 
    s.name.toLowerCase().includes(styleKeyword.toLowerCase()) ||
    s.keywords?.toLowerCase().includes(styleKeyword.toLowerCase())
  ) || styles[0];
  
  // Get matching colors
  const colorPalette = colors.find(c => 
    c.name.toLowerCase().includes('modern') || c.category?.toLowerCase().includes('vibrant')
  );

  // Get matching typography
  const fontPair = typography.find(t => 
    t.style?.toLowerCase().includes(styleKeyword.toLowerCase()) ||
    t.name?.toLowerCase().includes('modern')
  );

  // UX guidelines for this product type
  const uxGuidelines = loadUXGuidelines().slice(0, 5);

  return {
    product: matched.name,
    category: matched.category,
    recommendedStyle: matched.style,
    secondaryStyles: matched.secondary || '',
    styleKeywords: style?.keywords || '',
    styleEffects: style?.effects || '',
    designSystem: {
      style: style?.name || matched.style || 'Modern Professional',
      styleDescription: style?.description || style?.keywords || '',
      palette: colorPalette?.colors || matched.colors || '',
      paletteName: colorPalette?.name || '',
      fonts: fontPair ? `${fontPair.heading} / ${fontPair.body}` : 'Inter / Inter',
      fontName: fontPair?.name || 'Modern Sans'
    },
    keyConsiderations: matched.key_considerations || '',
    uxGuidelines: uxGuidelines.map(g => `✅ ${g.rule}: ${g.description}`),
    implementation: `Use Tailwind CSS with "${matched.style}" aesthetic. ${matched.key_considerations || ''}. Font: ${fontPair ? `${fontPair.heading} (headings) + ${fontPair.body} (body)` : 'Inter for all text'}.`
  };
}

// ─── Search ───────────────────────────────────────────────────
function search(query) {
  const productResults = searchCSV(path.join(DATA_DIR, 'products.csv'), query, 5);
  const colorResults = searchCSV(path.join(DATA_DIR, 'colors.csv'), query, 5);
  const styleResults = searchCSV(path.join(DATA_DIR, 'styles.csv'), query, 3);
  const typographyResults = searchCSV(path.join(DATA_DIR, 'typography.csv'), query, 3);
  const uxResults = searchCSV(path.join(DATA_DIR, 'ux-guidelines.csv'), query, 3);

  return {
    query,
    products: productResults.map(p => p.name || p.product || p.product_name),
    colors: colorResults.map(c => ({ name: c.name || c.palette_name, colors: c.colors || c.hex })),
    styles: styleResults.map(s => s.name || s.style_name),
    typography: typographyResults.map(t => ({ name: t.name || t.pairing_name, heading: t.heading || t.heading_font, body: t.body || t.body_font })),
    uxGuidelines: uxResults.map(u => u.rule || u.guideline || u.name)
  };
}

// ─── Main Handler ─────────────────────────────────────────────
export default {
  name: 'ui_ux_pro_max',
  description: 'Design intelligence: 50+ styles, 161 palettes, 57 font pairings, 161 product types, 99 UX guidelines, 25 chart types. Generates complete design systems for any industry. Actions: design_system, search, palette, typography, guidelines.',
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['design_system', 'search', 'palette', 'typography', 'guidelines', 'styles'],
        description: 'Action: design_system (full system for product type), search (find anything), palette (color palettes), typography (font pairings), guidelines (UX rules), styles (design styles)'
      },
      query: {
        type: 'string',
        description: 'Product type (e.g. education, fintech, healthcare, saas), style name, or search term'
      }
    },
    required: ['action']
  },

  async handler({ action, query }) {
    try {
      switch (action) {
        case 'design_system':
          if (!query) throw new Error('query required. Examples: "education", "fintech", "healthcare", "saas", "ecommerce", "gaming"');
          return generateDesignSystem(query);
        
        case 'search':
          if (!query) throw new Error('query required');
          return search(query);
        
        case 'palette':
          if (!query) {
            const all = loadColors().slice(0, 20);
            return { palettes: all.map(c => ({ name: c.name, colors: c.colors })) };
          }
          return { palettes: searchCSV(path.join(DATA_DIR, 'colors.csv'), query, 10).map(c => ({ name: c.name || c.palette_name, colors: c.colors || c.hex })) };
        
        case 'typography':
          if (!query) {
            const all = loadTypography().slice(0, 20);
            return { fonts: all.map(t => ({ name: t.name, heading: t.heading, body: t.body })) };
          }
          return { fonts: searchCSV(path.join(DATA_DIR, 'typography.csv'), query, 10).map(t => ({ name: t.name || t.pairing_name, heading: t.heading || t.heading_font, body: t.body || t.body_font })) };
        
        case 'guidelines':
          const all = loadUXGuidelines();
          if (query) {
            return { guidelines: all.filter(g => g.category?.toLowerCase().includes(query.toLowerCase()) || g.rule?.toLowerCase().includes(query.toLowerCase())).slice(0, 10) };
          }
          return { guidelines: all.slice(0, 15) };
        
        case 'styles':
          const allStyles = loadStyles();
          if (query) {
            return { styles: searchCSV(path.join(DATA_DIR, 'styles.csv'), query, 10).map(s => ({ name: s.name || s.style_name, description: s.description })) };
          }
          return { styles: allStyles.slice(0, 20).map(s => ({ name: s.name, description: s.description, category: s.category })) };
        
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (err) {
      return { error: err.message, action, query };
    }
  }
};
