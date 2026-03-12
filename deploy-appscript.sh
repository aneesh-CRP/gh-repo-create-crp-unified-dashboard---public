#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# CRP Dashboard — Apps Script Deploy Script
# Syncs index.html → appscript/Dashboard.html and pushes to Apps Script
# ═══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPSCRIPT_DIR="$SCRIPT_DIR/appscript"

echo "═══════════════════════════════════════════"
echo "  CRP Dashboard → Apps Script Deploy"
echo "═══════════════════════════════════════════"

# Check for clasp
if ! command -v clasp &> /dev/null; then
    echo "❌ clasp not found. Install with:"
    echo "   npm install -g @google/clasp"
    exit 1
fi

# Check for .clasp.json
if [ ! -f "$APPSCRIPT_DIR/.clasp.json" ]; then
    echo "❌ No .clasp.json found in appscript/"
    echo ""
    echo "First-time setup:"
    echo "  1. Go to script.google.com → New Project → name it 'CRP-Dashboard'"
    echo "  2. Go to Project Settings → copy the Script ID"
    echo "  3. Run: cp appscript/.clasp.json.template appscript/.clasp.json"
    echo "  4. Edit appscript/.clasp.json and replace YOUR_SCRIPT_ID_HERE"
    echo "  5. Run: clasp login  (one-time auth)"
    echo "  6. Re-run this script"
    exit 1
fi

# Build Dashboard.html (split JS to external file for size limits)
echo ""
echo "📄 Building appscript/Dashboard.html (HTML shell + external JS)..."
python3 "$SCRIPT_DIR/scripts/build-appscript.py"
echo "   ✓ Dashboard.html updated ($(wc -c < "$APPSCRIPT_DIR/Dashboard.html") bytes)"

# Push to Apps Script
echo ""
echo "🚀 Pushing to Apps Script..."
cd "$APPSCRIPT_DIR"
clasp push

echo ""
echo "✅ Push complete!"
echo ""

# Deploy new version if --deploy flag passed
if [ "$1" = "--deploy" ]; then
    echo "📦 Creating new deployment..."
    VERSION_DESC="v$(date +%Y%m%d-%H%M) auto-deploy"
    clasp deploy --description "$VERSION_DESC"
    echo "✅ Deployed: $VERSION_DESC"
else
    echo "ℹ️  To also deploy a new version, run:"
    echo "   ./deploy-appscript.sh --deploy"
    echo ""
    echo "   Or deploy manually:"
    echo "   cd appscript && clasp deploy --description 'description here'"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  GitHub Pages: still live at your .github.io URL"
echo "  Apps Script:  check script.google.com for web app URL"
echo "═══════════════════════════════════════════"
