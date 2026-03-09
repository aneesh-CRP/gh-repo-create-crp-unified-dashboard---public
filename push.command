#!/bin/bash
# CRP Dashboard — Auto Push to GitHub
# Double-click this file to push all committed changes to GitHub
cd "$(dirname "$0")"
echo "🚀 Pushing CRP Dashboard to GitHub..."
echo ""
git status --short
echo ""
git push origin main 2>&1
echo ""
if [ $? -eq 0 ]; then
    echo "✅ Successfully pushed to GitHub!"
    echo "🌐 Your dashboard will be live in ~60 seconds at:"
    echo "   https://aneesh-crp.github.io/gh-repo-create-crp-unified-dashboard---public/"
else
    echo "❌ Push failed. Check your internet connection or GitHub authentication."
fi
echo ""
echo "Press any key to close..."
read -n 1
