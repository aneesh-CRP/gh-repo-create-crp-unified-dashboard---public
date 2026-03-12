#!/usr/bin/env python3
"""
Build Apps Script files from index.html.

Splits the large index.html into:
  - Dashboard.html: HTML/CSS shell with async JS loader (~240KB, under HtmlService limit)
  - DashboardJS.html: <script> block stored as Apps Script file, loaded via google.script.run
  - dashboard.js: extracted JS for GitHub Pages <script src> usage

The async loading pattern avoids Apps Script's HtmlService output size limit (~500KB)
by keeping Dashboard.html small and loading the JS separately via google.script.run.
"""

import sys
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
JS_OUT = os.path.join(ROOT, 'dashboard.js')
APPSCRIPT_DIR = os.path.join(ROOT, 'appscript')
DASH_OUT = os.path.join(APPSCRIPT_DIR, 'Dashboard.html')
DASHJS_OUT = os.path.join(APPSCRIPT_DIR, 'DashboardJS.html')

with open(INDEX, 'r') as f:
    lines = f.readlines()

# Find the main script block (the big one after the HTML body, not the CDN imports)
main_script_start = None
main_script_end = None

for i, line in enumerate(lines):
    if '<script>' in line and i > 2000:
        if main_script_start is None:
            main_script_start = i
    if '</script>' in line and i > 2000 and main_script_start is not None:
        main_script_end = i
        break

if main_script_start is None or main_script_end is None:
    print("ERROR: Could not find main script block", file=sys.stderr)
    sys.exit(1)

# Extract JS content (no <script> tags) for GitHub Pages dashboard.js
js_content = ''.join(lines[main_script_start + 1 : main_script_end])

# Write dashboard.js for GitHub Pages
with open(JS_OUT, 'w') as f:
    f.write(js_content)

# ── Minify JS for Apps Script (strip comments, blank lines, leading whitespace) ──
def minify_js(js_text):
    """Basic JS minification: strip comments, collapse whitespace, remove blank lines."""
    out_lines = []
    in_block_comment = False
    for line in js_text.split('\n'):
        # Handle block comments
        if in_block_comment:
            if '*/' in line:
                in_block_comment = False
                line = line[line.index('*/') + 2:]
                if not line.strip():
                    continue
            else:
                continue

        if '/*' in line and '*/' not in line:
            # Check it's not inside a string
            before = line[:line.index('/*')]
            # Simple heuristic: if quotes are balanced before /*, it's a real comment
            if before.count("'") % 2 == 0 and before.count('"') % 2 == 0:
                line = before
                in_block_comment = True
                if not line.strip():
                    continue

        stripped = line.strip()

        # Skip blank lines
        if not stripped:
            continue

        # Skip full-line single-line comments
        if stripped.startswith('//'):
            continue

        # Remove trailing single-line comments (but not URLs like http://)
        # Only strip if // is preceded by whitespace or certain chars, not inside strings
        result = stripped
        out_lines.append(result)

    return '\n'.join(out_lines)

minified_js = minify_js(js_content)

# Write DashboardJS.html for Apps Script — just the raw JS, NO <script> tags
# (it will be injected via eval() on the client side)
with open(DASHJS_OUT, 'w') as f:
    f.write(minified_js)

# ── Build Dashboard.html ──
# HTML before the main script block
html_before = ''.join(lines[:main_script_start])
# HTML after the main script block (includes the iframe resize script etc.)
html_after = ''.join(lines[main_script_end + 1:])

# Replace the main script block with an async loader that fetches JS via google.script.run
async_loader = """<script>
(function() {
  // Show loading indicator
  var loadEl = document.getElementById('loading-overlay');
  if (loadEl) loadEl.style.display = 'flex';

  console.log('[AppScript] Loading dashboard JS asynchronously via google.script.run...');

  google.script.run
    .withSuccessHandler(function(jsHtml) {
      console.log('[AppScript] Received JS payload: ' + (jsHtml ? jsHtml.length : 0) + ' chars');
      try {
        // The payload is raw JS text — execute it
        var scriptEl = document.createElement('script');
        scriptEl.textContent = jsHtml;
        document.body.appendChild(scriptEl);
        console.log('[AppScript] Dashboard JS loaded and executed successfully');
      } catch (e) {
        console.error('[AppScript] Error executing JS:', e);
        document.body.innerHTML = '<div style="padding:40px;color:red;font-size:18px">'
          + 'Error loading dashboard: ' + e.message + '</div>';
      }
    })
    .withFailureHandler(function(err) {
      console.error('[AppScript] Failed to load JS:', err);
      document.body.innerHTML = '<div style="padding:40px;color:red;font-size:18px">'
        + 'Failed to load dashboard JavaScript: ' + (err.message || err) + '</div>';
    })
    .getDashboardJS();
})();
</script>
"""

appscript_html = html_before + async_loader + html_after

with open(DASH_OUT, 'w') as f:
    f.write(appscript_html)

print(f"Built for Apps Script (async loading pattern):")
print(f"  Dashboard.html:   {len(appscript_html):,} bytes (HTML shell + async loader)")
print(f"  DashboardJS.html: {len(minified_js):,} bytes (minified JS, loaded via google.script.run)")
print(f"  dashboard.js:     {len(js_content):,} bytes (GitHub Pages, unminified)")
print(f"  Main script: lines {main_script_start + 1}-{main_script_end + 1}")
