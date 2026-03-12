#!/usr/bin/env python3
"""
Build Apps Script files from index.html.

Splits the large index.html into:
  - Dashboard.html: HTML/CSS shell with async JS chunk loader (~240KB)
  - DashboardJS_0.html, DashboardJS_1.html, ...: JS chunks (<200KB each)
  - dashboard.js: full extracted JS for GitHub Pages

The async chunk-loading pattern avoids:
  1. HtmlService output size limit (~500KB) — Dashboard.html is only the HTML shell
  2. google.script.run return value limit (~256KB) — JS split into <200KB chunks
"""

import sys
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
JS_OUT = os.path.join(ROOT, 'dashboard.js')
APPSCRIPT_DIR = os.path.join(ROOT, 'appscript')
DASH_OUT = os.path.join(APPSCRIPT_DIR, 'Dashboard.html')

CHUNK_MAX = 180000  # ~180KB per chunk, safely under 256KB limit

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

# Extract JS content (no <script> tags)
js_content = ''.join(lines[main_script_start + 1 : main_script_end])

# Write dashboard.js for GitHub Pages (unminified)
with open(JS_OUT, 'w') as f:
    f.write(js_content)

# ── Minify JS ──
def minify_js(js_text):
    """Basic JS minification: strip comments, collapse whitespace, remove blank lines."""
    out_lines = []
    in_block_comment = False
    for line in js_text.split('\n'):
        if in_block_comment:
            if '*/' in line:
                in_block_comment = False
                line = line[line.index('*/') + 2:]
                if not line.strip():
                    continue
            else:
                continue

        if '/*' in line and '*/' not in line:
            before = line[:line.index('/*')]
            if before.count("'") % 2 == 0 and before.count('"') % 2 == 0:
                line = before
                in_block_comment = True
                if not line.strip():
                    continue

        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith('//'):
            continue

        out_lines.append(stripped)

    return '\n'.join(out_lines)

minified_js = minify_js(js_content)

# ── Split JS into chunks at line boundaries ──
chunks = []
current_chunk = []
current_size = 0

for line in minified_js.split('\n'):
    line_size = len(line) + 1  # +1 for newline
    if current_size + line_size > CHUNK_MAX and current_chunk:
        chunks.append('\n'.join(current_chunk))
        current_chunk = []
        current_size = 0
    current_chunk.append(line)
    current_size += line_size

if current_chunk:
    chunks.append('\n'.join(current_chunk))

num_chunks = len(chunks)
print(f"Split minified JS ({len(minified_js):,} bytes) into {num_chunks} chunks:")

# Clean up old chunk files
import glob
for old_file in glob.glob(os.path.join(APPSCRIPT_DIR, 'DashboardJS*.html')):
    os.remove(old_file)

# Write chunk files
for i, chunk in enumerate(chunks):
    chunk_path = os.path.join(APPSCRIPT_DIR, f'DashboardJS_{i}.html')
    with open(chunk_path, 'w') as f:
        f.write(chunk)
    print(f"  DashboardJS_{i}.html: {len(chunk):,} bytes")

# ── Build Dashboard.html ──
html_before = ''.join(lines[:main_script_start])
html_after = ''.join(lines[main_script_end + 1:])

# Async loader that fetches JS chunks via google.script.run and concatenates them
async_loader = f"""<script>
(function() {{
  var NUM_CHUNKS = {num_chunks};
  var loadedChunks = new Array(NUM_CHUNKS);
  var loadedCount = 0;
  var hadError = false;

  console.log('[AppScript] Loading dashboard JS in ' + NUM_CHUNKS + ' chunks...');

  function onAllLoaded() {{
    var fullJS = loadedChunks.join('\\n');
    console.log('[AppScript] All chunks loaded, total: ' + fullJS.length + ' chars. Executing...');
    try {{
      var scriptEl = document.createElement('script');
      scriptEl.textContent = fullJS;
      document.body.appendChild(scriptEl);
      console.log('[AppScript] Dashboard JS executed successfully');
    }} catch (e) {{
      console.error('[AppScript] Error executing JS:', e);
      document.body.innerHTML = '<div style="padding:40px;color:red;font-size:18px">'
        + 'Error loading dashboard: ' + e.message + '</div>';
    }}
  }}

  function loadChunk(index) {{
    google.script.run
      .withSuccessHandler(function(content) {{
        if (hadError) return;
        loadedChunks[index] = content;
        loadedCount++;
        console.log('[AppScript] Chunk ' + index + '/' + NUM_CHUNKS + ' loaded (' + (content ? content.length : 0) + ' chars)');
        if (loadedCount === NUM_CHUNKS) {{
          onAllLoaded();
        }}
      }})
      .withFailureHandler(function(err) {{
        hadError = true;
        console.error('[AppScript] Failed to load chunk ' + index + ':', err);
        document.body.innerHTML = '<div style="padding:40px;color:red;font-size:18px">'
          + 'Failed to load dashboard JS chunk ' + index + ': ' + (err.message || err) + '</div>';
      }})
      .getDashboardJSChunk(index);
  }}

  // Load all chunks in parallel
  for (var i = 0; i < NUM_CHUNKS; i++) {{
    loadChunk(i);
  }}
}})();
</script>
"""

appscript_html = html_before + async_loader + html_after

with open(DASH_OUT, 'w') as f:
    f.write(appscript_html)

print(f"\nBuilt for Apps Script (async chunk-loading):")
print(f"  Dashboard.html:   {len(appscript_html):,} bytes (HTML shell + chunk loader)")
print(f"  dashboard.js:     {len(js_content):,} bytes (GitHub Pages, unminified)")
print(f"  Main script: lines {main_script_start + 1}-{main_script_end + 1}")
