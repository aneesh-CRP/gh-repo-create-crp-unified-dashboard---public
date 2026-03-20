#!/usr/bin/env node
/**
 * CRP Dashboard — Unit Tests
 * Run: node tests/run.js
 * No external dependencies required.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Extract JS from index.html
const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf-8');

// Find the main script block (after the HTML, before </script>)
const scriptMatch = html.match(/<script>([\s\S]*?function _crpInit[\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('ERROR: Could not extract main script block from index.html');
  process.exit(1);
}

// Extract just the utility functions we need to test
const jsContent = scriptMatch[1];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
  }
}

// ── Helper: extract and eval a function by regex ──
function extractFn(pattern) {
  const m = jsContent.match(pattern);
  if (!m) return null;
  return m[0];
}

console.log('\nCRP Dashboard — Unit Tests\n');

// ══════════ escapeHTML ══════════
console.log('escapeHTML:');
const escapeHTMLSrc = extractFn(/function escapeHTML\(str\)[^}]+}/);
if (escapeHTMLSrc) {
  eval(escapeHTMLSrc);

  test('escapes ampersand', () => {
    assert.strictEqual(escapeHTML('a & b'), 'a &amp; b');
  });

  test('escapes angle brackets', () => {
    assert.strictEqual(escapeHTML('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('escapes quotes', () => {
    assert.strictEqual(escapeHTML('"hello" & \'world\''), '&quot;hello&quot; &amp; &#39;world&#39;');
  });

  test('handles null/undefined', () => {
    assert.strictEqual(escapeHTML(null), '');
    assert.strictEqual(escapeHTML(undefined), '');
  });

  test('handles numbers', () => {
    assert.strictEqual(escapeHTML(42), '42');
  });

  test('returns empty string for empty input', () => {
    assert.strictEqual(escapeHTML(''), '');
  });
} else {
  console.log('  SKIP: escapeHTML not found in source');
}

// ══════════ jsAttr ══════════
console.log('\njsAttr:');
const jsAttrSrc = extractFn(/function jsAttr\(s\)[^}]+}/);
if (jsAttrSrc && typeof escapeHTML === 'function') {
  eval(jsAttrSrc);

  test('escapes single quotes for onclick', () => {
    const result = jsAttr("it's");
    // jsAttr runs escapeHTML after escaping, so ' becomes &#39; (via escapeHTML) or \\'
    assert.ok(!result.includes("'") || result.includes("\\'") || result.includes('&#39;'), 'should escape single quotes');
  });

  test('escapes backslashes', () => {
    assert.ok(jsAttr('a\\b').includes('\\\\'), 'should escape backslashes');
  });

  test('handles null', () => {
    assert.strictEqual(jsAttr(null), '');
  });

  test('HTML-escapes angle brackets', () => {
    const result = jsAttr('<script>');
    assert.ok(!result.includes('<'), 'should not contain raw <');
  });
} else {
  console.log('  SKIP: jsAttr not found or escapeHTML missing');
}

// ══════════ _parseDate ══════════
console.log('\n_parseDate:');
const parseDateSrc = extractFn(/function _parseDate\(s\)[\s\S]*?return isNaN\(d\.getTime\(\)\) \? null : d;\s*\}/);
if (parseDateSrc) {
  eval(parseDateSrc);

  test('parses YYYY-MM-DD as local time', () => {
    const d = _parseDate('2026-03-15');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getDate(), 15);
    assert.strictEqual(d.getMonth(), 2); // March = 2
    assert.strictEqual(d.getFullYear(), 2026);
  });

  test('returns null for empty string', () => {
    assert.strictEqual(_parseDate(''), null);
  });

  test('returns null for null', () => {
    assert.strictEqual(_parseDate(null), null);
  });

  test('returns null for garbage', () => {
    assert.strictEqual(_parseDate('not-a-date-at-all'), null);
  });

  test('parses ISO datetime', () => {
    const d = _parseDate('2026-03-15T10:30:00');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getDate(), 15);
  });
} else {
  console.log('  SKIP: _parseDate not found in source');
}

// ══════════ normalize + buildKey ══════════
console.log('\nnormalize + buildKey:');
const normalizeSrc = extractFn(/function normalize\(s\)[\s\S]*?\}/);
const buildKeySrc = extractFn(/function buildKey\(\/\* \.\.\.parts \*\/\)[\s\S]*?\}/);
if (normalizeSrc && buildKeySrc) {
  eval(normalizeSrc);
  eval(buildKeySrc);

  test('normalize trims and lowercases', () => {
    assert.strictEqual(normalize('  Hello World  '), 'hello world');
  });

  test('normalize collapses whitespace', () => {
    assert.strictEqual(normalize('a   b'), 'a b');
  });

  test('normalize handles null', () => {
    assert.strictEqual(normalize(null), '');
  });

  test('buildKey joins with pipe', () => {
    assert.strictEqual(buildKey('Alice', 'Study-1'), 'alice|study-1');
  });

  test('buildKey normalizes parts', () => {
    assert.strictEqual(buildKey('  Alice ', ' STUDY-1 '), 'alice|study-1');
  });

  test('buildKey is consistent (no || separator)', () => {
    const k = buildKey('name', 'study');
    assert.ok(!k.includes('||'), 'should use | not ||');
    assert.ok(k.includes('|'), 'should contain | separator');
  });
} else {
  console.log('  SKIP: normalize/buildKey not found in source');
}

// ══════════ fmtK ══════════
console.log('\nfmtK:');
const fmtKSrc = extractFn(/const fmtK=v=>[^;]+;/);
if (fmtKSrc) {
  eval('var ' + fmtKSrc.slice(6)); // convert const→var for eval scope

  test('formats thousands as K', () => {
    assert.strictEqual(fmtK(5000), '$5K');
  });

  test('formats small values without K', () => {
    assert.strictEqual(fmtK(500), '$500');
  });

  test('formats zero', () => {
    assert.strictEqual(fmtK(0), '$0');
  });

  test('formats large values', () => {
    assert.strictEqual(fmtK(1500000), '$1,500K');
  });
} else {
  console.log('  SKIP: fmtK not found in source');
}

// ══════════ categorizeReason ══════════
console.log('\ncategorizeReason:');
// categorizeReason is inside processLiveData — extract it
const catSrc = jsContent.match(/function categorizeReason\(reason, apptType\)\s*\{[\s\S]*?return 'Other';\s*\}/);
if (catSrc) {
  eval(catSrc[0]);

  test('completed visit', () => {
    assert.strictEqual(categorizeReason('Visit completed', ''), 'Completed');
  });

  test('not completed is not Completed', () => {
    assert.notStrictEqual(categorizeReason('not completed', ''), 'Completed');
  });

  test('screen fail', () => {
    assert.strictEqual(categorizeReason('Screen Fail - BMI too high', ''), 'Screen Fail / DNQ');
  });

  test('BMI word boundary (submitted should not match)', () => {
    assert.notStrictEqual(categorizeReason('form submitted', ''), 'Screen Fail / DNQ');
  });

  test('DNQ word boundary', () => {
    assert.strictEqual(categorizeReason('patient DNQ', ''), 'Screen Fail / DNQ');
  });

  test('no show by type', () => {
    assert.strictEqual(categorizeReason('', 'No Show'), 'No Show');
  });

  test('no show by reason', () => {
    assert.strictEqual(categorizeReason('did not answer phone', ''), 'No Show');
  });

  test('rescheduled', () => {
    assert.strictEqual(categorizeReason('rescheduled to next week', ''), 'Rescheduled');
  });

  test('rescheduled does not match "did not call back"', () => {
    assert.notStrictEqual(categorizeReason('did not call back, will reschedule', ''), 'Rescheduled');
  });

  test('weather with word boundary', () => {
    assert.strictEqual(categorizeReason('cancelled due to snow', ''), 'Weather');
  });

  test('withdrew', () => {
    assert.strictEqual(categorizeReason('patient withdrew consent', ''), 'Patient Withdrew');
  });

  test('admin error', () => {
    assert.strictEqual(categorizeReason('scheduled in error', ''), 'Admin Error');
  });

  test('demo word boundary', () => {
    assert.strictEqual(categorizeReason('this was a demo visit', ''), 'Admin Error');
  });

  test('not documented', () => {
    assert.strictEqual(categorizeReason('', ''), 'Not Documented');
    assert.strictEqual(categorizeReason('n/a', ''), 'Not Documented');
  });

  test('other fallback', () => {
    assert.strictEqual(categorizeReason('some random reason', ''), 'Other');
  });

  test('fibroscan by type', () => {
    assert.strictEqual(categorizeReason('', 'FibroScan Only'), 'FibroScan Only');
  });

  test('discontinued', () => {
    assert.strictEqual(categorizeReason('patient discontinued from study', ''), 'Discontinued');
  });

  test('study closed', () => {
    assert.strictEqual(categorizeReason('study closed enrollment', ''), 'Study Closed');
  });
} else {
  console.log('  SKIP: categorizeReason not found in source');
}

// ══════════ parseCSV ══════════
console.log('\nparseCSV:');
const parseCSVMatch = jsContent.match(/function parseCSV\(text\)[\s\S]*?return obj;\s*\}\);\s*\}/);
if (parseCSVMatch) {
  eval('var parseCSV = ' + parseCSVMatch[0].replace(/^function parseCSV/, 'function'));

  test('parses simple CSV', () => {
    const result = parseCSV('name,age\nAlice,30\nBob,25');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'Alice');
    assert.strictEqual(result[0].age, '30');
    assert.strictEqual(result[1].name, 'Bob');
  });

  test('handles quoted commas', () => {
    const result = parseCSV('name,location\n"Doe, John","New York, NY"');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'Doe, John');
    assert.strictEqual(result[0].location, 'New York, NY');
  });

  test('handles empty fields', () => {
    const result = parseCSV('a,b,c\n1,,3');
    assert.strictEqual(result[0].b, '');
  });

  test('handles single row', () => {
    const result = parseCSV('col1\nvalue1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].col1, 'value1');
  });
} else {
  console.log('  SKIP: parseCSV not found in source');
}

// ══════════ Data validation ══════════
console.log('\nData validation:');

test('fallback-data.json is valid JSON', () => {
  const fbPath = path.join(__dirname, '..', 'fallback-data.json');
  const data = JSON.parse(fs.readFileSync(fbPath, 'utf-8'));
  assert.ok(data.allVisitDetail, 'missing allVisitDetail');
  assert.ok(Array.isArray(data.allVisitDetail), 'allVisitDetail should be an array');
  assert.ok(data.allVisitDetail.length > 0, 'allVisitDetail should not be empty');
});

test('fallback-data.json has required fields', () => {
  const fbPath = path.join(__dirname, '..', 'fallback-data.json');
  const data = JSON.parse(fs.readFileSync(fbPath, 'utf-8'));
  const required = ['allVisitDetail', 'allCancels', 'cancelTotal', 'upcomingTotal'];
  required.forEach(field => {
    assert.ok(field in data, `missing required field: ${field}`);
  });
});

// ══════════ Static checks ══════════
console.log('\nStatic checks:');

test('index.html contains escapeHTML function', () => {
  assert.ok(html.includes('function escapeHTML(str)'), 'escapeHTML not found');
});

test('index.html contains showToast function', () => {
  assert.ok(html.includes('function showToast(message'), 'showToast not found');
});

test('index.html contains typeof window guard', () => {
  assert.ok(html.includes("typeof window !== 'undefined'"), 'window guard not found');
});

test('sw.js exists', () => {
  const swPath = path.join(__dirname, '..', 'sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js not found');
});

test('no duplicate studiesBody ID', () => {
  const matches = html.match(/id="studiesBody"/g);
  assert.ok(!matches || matches.length <= 1, `found ${matches ? matches.length : 0} studiesBody IDs (expected 0 or 1)`);
});

test('no new Date with bare YYYY-MM-DD in KPI onclick', () => {
  // The fixed version uses parseDate() not new Date()
  const kpiLine = html.match(/onclick="showUpcoming.*?Next 14 Days/);
  if (kpiLine) {
    assert.ok(kpiLine[0].includes('parseDate('), 'KPI onclick should use parseDate() not new Date()');
  }
});

test('buildKey uses | separator (not ||)', () => {
  const buildKeyLine = html.match(/function buildKey[\s\S]*?return parts\.join\(['"](.*?)['"]\)/);
  if (buildKeyLine) {
    assert.strictEqual(buildKeyLine[1], '|', 'buildKey should join with | not ||');
  }
});

// ── Summary ──
console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
