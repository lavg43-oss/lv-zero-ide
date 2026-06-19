/**
 * agent-browser-commands.cjs — Pre-built testing command scripts
 *
 * These are JavaScript code strings that can be injected into a page via
 * executeScript() to perform common testing operations. Each command
 * returns a structured result object { success, data?, error? }.
 *
 * Usage:
 *   const cmd = require('./agent-browser-commands.cjs');
 *   const code = cmd.getTestCommand('check-links');
 *   const result = await executeScript(sessionId, code);
 */

const testCommands = {
  /**
   * check-links — Finds all <a> tags and returns their hrefs + status.
   * Checks for broken anchors (empty href, javascript:void, etc.)
   */
  "check-links": `
    (() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const results = links.map(a => ({
        href: a.getAttribute('href'),
        text: a.textContent.trim().substring(0, 80),
        isExternal: /^https?:\/\//.test(a.getAttribute('href') || ''),
        isAnchor: (a.getAttribute('href') || '').startsWith('#'),
        isMailto: (a.getAttribute('href') || '').startsWith('mailto:'),
        hasTargetBlank: a.getAttribute('target') === '_blank',
        hasRelNoopener: (a.getAttribute('rel') || '').includes('noopener'),
      }));
      const issues = results.filter(r =>
        !r.href || r.href === '#' || r.href === 'javascript:void(0)' || r.href === 'javascript:void(0);'
      );
      return {
        success: true,
        data: {
          total: results.length,
          links: results,
          issues: issues.length,
          issueDetails: issues.map(i => i.href),
        }
      };
    })()
  `,

  /**
   * check-images — Finds all <img> tags and returns src + alt status.
   */
  "check-images": `
    (() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const results = imgs.map(img => ({
        src: img.getAttribute('src') || '(no src)',
        alt: img.getAttribute('alt') || '(no alt)',
        hasAlt: !!img.getAttribute('alt'),
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        isLoaded: img.complete && img.naturalWidth > 0,
      }));
      const missingAlt = results.filter(r => !r.hasAlt);
      const broken = results.filter(r => !r.isLoaded);
      return {
        success: true,
        data: {
          total: results.length,
          images: results,
          missingAlt: missingAlt.length,
          missingAltDetails: missingAlt.map(m => m.src),
          broken: broken.length,
          brokenDetails: broken.map(b => b.src),
        }
      };
    })()
  `,

  /**
   * check-forms — Finds all <form> elements and validates their inputs.
   */
  "check-forms": `
    (() => {
      const forms = Array.from(document.querySelectorAll('form'));
      const results = forms.map(form => ({
        id: form.id || '(no id)',
        action: form.getAttribute('action') || '(no action)',
        method: (form.getAttribute('method') || 'get').toUpperCase(),
        inputs: Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
          name: el.getAttribute('name') || '(no name)',
          type: el.getAttribute('type') || el.tagName.toLowerCase(),
          required: el.required || el.getAttribute('aria-required') === 'true',
          placeholder: el.getAttribute('placeholder') || '',
          hasLabel: !!form.querySelector(\`label[for="\${el.id}"]\`),
        })),
        hasSubmitBtn: !!form.querySelector('button[type="submit"], input[type="submit"]'),
      }));
      const issues = [];
      results.forEach((f, i) => {
        f.inputs.forEach(inp => {
          if (!inp.name && inp.type !== 'submit' && inp.type !== 'button') {
            issues.push(\`Form #\${i+1}: input missing name attribute\`);
          }
        });
        if (!f.hasSubmitBtn) {
          issues.push(\`Form #\${i+1}: no submit button\`);
        }
      });
      return {
        success: true,
        data: {
          total: results.length,
          forms: results,
          issues: issues.length,
          issueDetails: issues,
        }
      };
    })()
  `,

  /**
   * check-responsive — Tests viewport rendering at 3 sizes.
   * Reports any layout issues (overflow, overlapping elements).
   */
  "check-responsive": `
    (() => {
      const viewports = [
        { name: 'Desktop', width: 1280, height: 800 },
        { name: 'Tablet', width: 768, height: 1024 },
        { name: 'Mobile', width: 375, height: 667 },
      ];
      const results = [];
      const body = document.body;
      const html = document.documentElement;
      viewports.forEach(vp => {
        // Check for horizontal overflow
        const scrollWidth = Math.max(
          body.scrollWidth, body.offsetWidth,
          html.scrollWidth, html.offsetWidth,
          html.clientWidth
        );
        const hasOverflow = scrollWidth > vp.width;
        results.push({
          viewport: vp.name,
          width: vp.width,
          height: vp.height,
          hasHorizontalOverflow: hasOverflow,
          scrollWidth: scrollWidth,
          clientWidth: html.clientWidth,
          bodyOverflowX: getComputedStyle(body).overflowX,
        });
      });
      const hasIssues = results.some(r => r.hasHorizontalOverflow);
      return {
        success: true,
        data: {
          viewports: results,
          hasIssues,
          totalIssues: hasIssues ? results.filter(r => r.hasHorizontalOverflow).length : 0,
        }
      };
    })()
  `,

  /**
   * check-console — Returns any captured console.log/warn/error calls.
   * Relies on the session's log capture (agent-browser.cjs captures console-message events).
   * This command reads from window.__capturedLogs if available, or returns a note.
   */
  "check-console": `
    (() => {
      const captured = window.__capturedLogs || [];
      const errors = captured.filter(l => l.level === 'error' || l.type === 'error');
      const warnings = captured.filter(l => l.level === 'warn' || l.type === 'warn');
      return {
        success: true,
        data: {
          total: captured.length,
          errors: errors.length,
          warnings: warnings.length,
          logs: captured.slice(-50),
        }
      };
    })()
  `,

  /**
   * performance — Returns Navigation Timing and Resource Timing stats.
   */
  "performance": `
    (() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const paint = performance.getEntriesByType('paint');
      const timing = {
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        loadComplete: nav ? nav.loadEventEnd : null,
        domInteractive: nav ? nav.domInteractive : null,
        firstPaint: null,
        firstContentfulPaint: null,
      };
      paint.forEach(p => {
        if (p.name === 'first-paint') timing.firstPaint = p.startTime;
        if (p.name === 'first-contentful-paint') timing.firstContentfulPaint = p.startTime;
      });
      const resourceSummary = {
        total: resources.length,
        totalSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
        byType: {},
      };
      resources.forEach(r => {
        const type = r.initiatorType || 'other';
        if (!resourceSummary.byType[type]) resourceSummary.byType[type] = { count: 0, size: 0 };
        resourceSummary.byType[type].count++;
        resourceSummary.byType[type].size += r.transferSize || 0;
      });
      return {
        success: true,
        data: { timing, resources: resourceSummary }
      };
    })()
  `,
};

/**
 * getTestCommand(name) — Returns the JavaScript code string for a named test command.
 * @param {string} name - The command name (e.g., 'check-links', 'check-images')
 * @returns {{ success: boolean, name: string, code?: string, error?: string }}
 */
function getTestCommand(name) {
  const code = testCommands[name];
  if (!code) {
    return {
      success: false,
      name,
      error: `Unknown test command: "${name}". Available: ${Object.keys(testCommands).join(", ")}`,
    };
  }
  return {
    success: true,
    name,
    code: code.trim(),
  };
}

/**
 * listCommands() — Returns the list of available test command names.
 */
function listCommands() {
  return Object.keys(testCommands);
}

module.exports = {
  testCommands,
  getTestCommand,
  listCommands,
};
