#!/usr/bin/env node
/**
 * CRP Dashboard — Static Lint
 * Codifies CLAUDE.md rules as automated checks.
 * Run: node scripts/lint.js
 * Exit code 1 if any errors found, 0 if clean.
 */

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf-8');
const lines = html.split('\n');

let errors = 0;
let warnings = 0;

function error(line, rule, msg) {
  errors++;
  console.error(`  ERROR L${line}: [${rule}] ${msg}`);
}
function warn(line, rule, msg) {
  warnings++;
  console.warn(`  WARN  L${line}: [${rule}] ${msg}`);
}

console.log('\nCRP Dashboard — Static Lint\n');

// ══════════ Rule 1: new Date('YYYY-MM-DD') without parseDate ══════════
// Matches: new Date(variable) where the context suggests a YYYY-MM-DD string
// We check for new Date(someVar) near date_iso, cancel_date, enrollment, etc.
console.log('Rule: date-parsing');
const DATE_FIELD_CONTEXT = /(?:date_iso|cancel_date|enrollment_close|closeout_date|snapshot_date|Scheduled Date|irb_approval|contract_signed|siv_date|fps_date|enrollment_start)/i;
lines.forEach((line, i) => {
  const ln = i + 1;
  // Skip comments
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
  // Find new Date(<something>) that isn't parseDate or _parseDate
  const dateMatches = line.match(/new Date\(([^)]+)\)/g);
  if (!dateMatches) return;
  dateMatches.forEach(m => {
    const arg = m.replace(/new Date\(|\)/g, '');
    // Skip safe patterns
    if (arg === '' || arg === 'parsed') return; // no arg or known safe
    if (/T00:00:00/.test(arg)) return; // already appends T
    if (/\+\s*['"],?\s*['"]?\s*\+/.test(arg)) return; // string concatenation (e.g., "Mar 12" + ", " + year)
    if (/today|now|Date\.now|getFullYear|getMonth|getDate/.test(arg)) return; // dynamic date construction
    if (/^\d+$/.test(arg.trim())) return; // numeric timestamp
    if (/^new Date/.test(arg)) return; // nested new Date
    if (/\.getTime\(\)/.test(line)) return; // timestamp extraction context
    // Check if this line references a date field
    if (DATE_FIELD_CONTEXT.test(line) && !/_parseDate|parseDate/.test(line)) {
      error(ln, 'date-parsing', `new Date() with date field — use parseDate()/_parseDate(): ${m}`);
    }
  });
});

// ══════════ Rule 2: Hardcoded years ══════════
console.log('Rule: no-hardcoded-year');
lines.forEach((line, i) => {
  const ln = i + 1;
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
  // Match patterns like new Date(2026, or new Date('2026 or year references
  if (/new Date\(\s*20[2-3]\d\s*,/.test(line)) {
    error(ln, 'no-hardcoded-year', 'Hardcoded year in Date constructor — use new Date().getFullYear()');
  }
});

// ══════════ Rule 3: Manual key concatenation instead of buildKey ══════════
console.log('Rule: use-buildKey');
lines.forEach((line, i) => {
  const ln = i + 1;
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
  // Detect || as separator in key-like patterns (name + '||' + study)
  if (/['"]?\s*\+\s*['"]?\|\|['"]?\s*\+/.test(line)) {
    error(ln, 'use-buildKey', 'Manual key with || separator — use buildKey() which joins with |');
  }
});

// ══════════ Rule 4: Duplicate HTML attributes ══════════
console.log('Rule: no-duplicate-attrs');
// Extract individual opening tags and check each for duplicate attrs
lines.forEach((line, i) => {
  const ln = i + 1;
  // Match each opening tag individually
  const tags = line.match(/<[a-zA-Z][^>]*>/g);
  if (!tags) return;
  tags.forEach(tag => {
    const classCount = (tag.match(/\bclass=/g) || []).length;
    if (classCount > 1) {
      error(ln, 'no-duplicate-attrs', `Duplicate class= on single element: ${tag.substring(0, 60)}...`);
    }
    const styleCount = (tag.match(/\bstyle=/g) || []).length;
    if (styleCount > 1) {
      warn(ln, 'no-duplicate-attrs', `Duplicate style= on single element: ${tag.substring(0, 60)}...`);
    }
  });
});

// ══════════ Rule 5: Duplicate element IDs ══════════
console.log('Rule: no-duplicate-ids');
const idMap = {};
lines.forEach((line, i) => {
  const ln = i + 1;
  const ids = line.match(/\bid="([^"]+)"/g);
  if (!ids) return;
  ids.forEach(m => {
    const id = m.match(/id="([^"]+)"/)[1];
    // Skip dynamic IDs (template literals)
    if (id.includes('${') || id.includes("'+")) return;
    if (idMap[id]) {
      error(ln, 'no-duplicate-ids', `Duplicate id="${id}" (first at L${idMap[id]})`);
    } else {
      idMap[id] = ln;
    }
  });
});

// ══════════ Rule 6: Manual .replace(/'/g for onclick instead of jsAttr ══════════
console.log('Rule: use-jsAttr');
lines.forEach((line, i) => {
  const ln = i + 1;
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
  // Detect .replace(/'/g, patterns near onclick
  if (line.includes(".replace(/'/g") && /onclick|setAttribute/.test(line)) {
    warn(ln, 'use-jsAttr', 'Manual quote escaping for onclick — use jsAttr() instead');
  }
});

// ══════════ Rule 7: openModal with wrong arg count ══════════
console.log('Rule: openModal-args');
lines.forEach((line, i) => {
  const ln = i + 1;
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
  // Find openModal calls — should have 3 args
  const openModalCalls = line.match(/openModal\(/g);
  if (!openModalCalls) return;
  // Balance parentheses to find real closing paren of openModal(...)
  const idx = line.indexOf('openModal(');
  if (idx === -1) return;
  let depth = 0, start = idx + 10, end = -1;
  for (let j = start; j < line.length; j++) {
    if (line[j] === '(') depth++;
    else if (line[j] === ')') {
      if (depth === 0) { end = j; break; }
      depth--;
    }
  }
  if (end > start) {
    const args = line.substring(start, end);
    // Count top-level commas (not inside nested parens/strings)
    let commas = 0, d = 0, inStr = null;
    for (let j = 0; j < args.length; j++) {
      const c = args[j];
      if (inStr) { if (c === inStr && args[j-1] !== '\\') inStr = null; continue; }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '(') d++;
      else if (c === ')') d--;
      else if (c === ',' && d === 0) commas++;
    }
    if (commas < 2 && args.trim().length > 0) {
      warn(ln, 'openModal-args', 'openModal() needs 3 args: (title, subtitle, bodyHtml)');
    }
  }
});

// ══════════ Rule 8: innerHTML with CSV data patterns missing escapeHTML ══════════
console.log('Rule: escape-innerHTML');
// Check for common patterns where CSV data goes into innerHTML without escapeHTML
// This is heuristic — looks for .innerHTML assignments with + concatenation of raw variables
const UNSAFE_PATTERNS = [
  // r.invoice, r.due, etc. without escapeHTML wrapping
  /\+\s*(?:r|p|i|s|f)\.(name|study|invoice|due|reason|status|coord|coordinator|investigator)\b(?!\s*\))/,
];
lines.forEach((line, i) => {
  const ln = i + 1;
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
  if (!/innerHTML/.test(line) && !/\.innerHTML/.test(lines[Math.max(0, i-1)])) return;
  UNSAFE_PATTERNS.forEach(pat => {
    if (pat.test(line) && !/escapeHTML|esc\(|maskPHI|pUrl|sUrl|pLink|sLink|patientLink/.test(line)) {
      warn(ln, 'escape-innerHTML', `Possible unescaped CSV data in innerHTML: ${line.trim().substring(0, 80)}...`);
    }
  });
});

// ══════════ Rule 9: async function without try/finally guard ══════════
console.log('Rule: async-guard');
// Check that key async functions have in-flight guards
const GUARDED_FNS = ['refreshData', 'autoRefreshAll', 'fetchCrioStudies'];
GUARDED_FNS.forEach(fn => {
  const fnRegex = new RegExp(`async function ${fn}\\b`);
  const guardRegex = new RegExp(`_${fn.replace(/^fetch/, '').replace(/^auto/, 'auto')}InFlight|_refreshInFlight|_crioFetchInFlight|_autoRefreshInFlight`);
  let fnLine = null;
  lines.forEach((line, i) => {
    if (fnRegex.test(line)) fnLine = i + 1;
  });
  if (fnLine) {
    // Check next 5 lines for a guard
    const nearby = lines.slice(fnLine - 1, fnLine + 5).join('\n');
    if (!/InFlight/.test(nearby)) {
      warn(fnLine, 'async-guard', `async function ${fn}() may lack an in-flight guard`);
    }
  }
});

// ══════════ Rule 10: Regex in categorizeReason without \b ══════════
console.log('Rule: regex-boundaries');
// Find the categorizeReason function and check for short patterns without \b
let inCategorize = false;
lines.forEach((line, i) => {
  const ln = i + 1;
  if (/function categorizeReason/.test(line)) inCategorize = true;
  if (inCategorize && /^  \}/.test(line)) inCategorize = false;
  if (!inCategorize) return;
  // Find regex patterns (handle escaped slashes inside regex)
  const regexes = line.match(/\/(?:[^/\\]|\\.)+\//g);
  if (!regexes) return;
  regexes.forEach(rx => {
    // Extract alternations
    const body = rx.slice(1, -1);
    const parts = body.split('|');
    parts.forEach(p => {
      if (/\\\//.test(p)) return; // compound abbreviation like s\/f — has natural boundary
      const clean = p.replace(/\\[bBdDwWsS]/g, '').replace(/\\[\/\'\"]/g, '').replace(/[.?+*^$[\](){}\/]/g, '');
      if (clean.length > 0 && clean.length <= 3 && !/\\b/.test(p) && !/[\/()]/.test(p)) {
        // Short word without \b boundary
        warn(ln, 'regex-boundaries', `Short pattern "${clean}" in categorizeReason may need \\b word boundaries`);
      }
    });
  });
});

// ══════════ Summary ══════════
console.log(`\n${errors} errors, ${warnings} warnings\n`);
if (errors > 0) {
  console.error('Lint FAILED — fix errors before committing.\n');
  process.exit(1);
}
if (warnings > 0) {
  console.log('Lint passed with warnings.\n');
}
process.exit(0);
