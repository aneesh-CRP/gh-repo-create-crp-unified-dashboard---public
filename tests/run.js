#!/usr/bin/env node
/**
 * CRP Dashboard — Basic Unit Tests
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

// Create a minimal mock environment so we can eval the functions
const mockEnv = `
  var window = undefined;
  var document = { readyState: 'complete', addEventListener: function(){}, getElementById: function(){ return null; }, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; }, hidden: false, body: { insertBefore: function(){}, firstChild: null } };
  var navigator = { onLine: true, serviceWorker: undefined };
  var google = undefined;
  var localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };
  var sessionStorage = { getItem: function(){ return null; }, setItem: function(){} };
  var location = { hash: '', hostname: 'localhost' };
  var history = { replaceState: function(){} };
  var Chart = undefined;
  var fetch = function(){ return Promise.resolve({ ok: true, text: function(){ return Promise.resolve(''); }, json: function(){ return Promise.resolve({}); } }); };
  var requestAnimationFrame = function(fn) { fn(); };
  var setTimeout = function(fn) { /* don't execute */ };
  var setInterval = function() { return 0; };
  var clearTimeout = function() {};
  var console = { log: function(){}, warn: function(){}, error: function(){} };
  var URL = function(u) { this.searchParams = { delete: function(){} }; this.toString = function(){ return u; }; };
  URL.createObjectURL = function(){ return ''; };
  URL.revokeObjectURL = function(){};
  var Blob = function(){};
  var Promise = global.Promise;
`;

// Extract just the utility functions we need to test
const jsContent = scriptMatch[1];

// Extract escapeHTML
const escapeHTMLMatch = jsContent.match(/function escapeHTML\(str\)[^}]+}/);
// Extract parseCSV
const parseCSVMatch = jsContent.match(/function parseCSV\(text\)[\s\S]*?return obj;\s*\}\);\s*\}/);

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

console.log('\nCRP Dashboard — Unit Tests\n');

// ── escapeHTML tests ──
console.log('escapeHTML:');
if (escapeHTMLMatch) {
  eval(escapeHTMLMatch[0]);

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

// ── parseCSV tests ──
console.log('\nparseCSV:');
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

// ── Data validation tests ──
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

// ── Summary ──
console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
