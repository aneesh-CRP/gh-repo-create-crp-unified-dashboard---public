#!/usr/bin/env python3
"""
Build Apps Script Dashboard.html from index.html.

Extracts the main <script> block (the large JS section) and replaces it
with a <script src> pointing to dashboard.js on GitHub Pages.
This keeps the Apps Script HTML under the HtmlService size limit (~300KB).

Also extracts dashboard.js as a separate file for GitHub Pages hosting.
"""

import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
JS_OUT = os.path.join(ROOT, 'dashboard.js')
DASH_OUT = os.path.join(ROOT, 'appscript', 'Dashboard.html')
GH_PAGES_BASE = 'https://aneesh-crp.github.io/gh-repo-create-crp-unified-dashboard---public'

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

# Extract JS content
js_lines = lines[main_script_start + 1 : main_script_end]
js_content = ''.join(js_lines)

# Write dashboard.js
with open(JS_OUT, 'w') as f:
    f.write(js_content)

# Build Dashboard.html: HTML before script + external script reference + HTML after script
html_before = ''.join(lines[:main_script_start])
html_after = ''.join(lines[main_script_end + 1:])

appscript_html = (
    html_before
    + f'<script src="{GH_PAGES_BASE}/dashboard.js"></script>\n'
    + html_after
)

with open(DASH_OUT, 'w') as f:
    f.write(appscript_html)

print(f"Built: Dashboard.html ({len(appscript_html):,} bytes) + dashboard.js ({len(js_content):,} bytes)")
print(f"  Main script: lines {main_script_start + 1}-{main_script_end + 1}")
