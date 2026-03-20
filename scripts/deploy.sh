#!/bin/bash
# CRP Dashboard — Full Build + Deploy Pipeline
#
# Usage: ./scripts/deploy.sh [commit message]
#
# Steps:
#   1. Build dashboard (index.html → appscript/ + dashboard.js)
#   2. Sync BQ script to appscript/
#   3. Push to Apps Script via clasp
#   4. Commit and push to GitHub
#
# The 15-minute Apps Script trigger handles BQ sync execution.
# To run BQ sync immediately after deploy, use:
#   clasp run syncBigQueryCancels  (requires one-time GCP setup)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== CRP Dashboard Deploy ==="

# 1. Build
echo "Step 1: Building Apps Script output..."
python3 scripts/build-appscript.py

# 2. Sync BQ script
echo "Step 2: Syncing BigQuery cancels script..."
cp scripts/bigquery-cancels-sync.gs appscript/BigQueryCancels.gs

# 3. Push to Apps Script
echo "Step 3: Pushing to Apps Script via clasp..."
clasp push --force

# 4. Git commit + push
MSG="${1:-Auto-deploy dashboard updates}"
echo "Step 4: Committing and pushing..."

git add index.html dashboard.js appscript/ scripts/
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "$MSG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
  git push
fi

echo ""
echo "=== Deploy complete ==="
echo "Dashboard will use new code immediately."
echo "BQ sync trigger fires every 15 minutes (or run manually in Apps Script)."
