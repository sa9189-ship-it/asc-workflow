#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ASC Workflow — Railway Deployment Script
# Run this once from your Mac Terminal:
#   chmod +x deploy-to-railway.sh
#   ./deploy-to-railway.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_NAME="asc-workflow"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       ASC Workflow — Railway Deployment Script       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Git setup ────────────────────────────────────────────────────────
echo "▶  Step 1 — Initialising git repository..."
cd "$PROJECT_DIR"

# Clean up any stale lock file from a previous interrupted run
if [ -f ".git/index.lock" ]; then
  echo "   (removing stale .git/index.lock)"
  rm -f ".git/index.lock"
fi

# Init only if not already a git repo
if [ ! -d ".git" ]; then
  git init
  git checkout -b main
fi

# Make sure we're on main
git checkout -b main 2>/dev/null || git checkout main

# Stage everything (node_modules, .env etc. are excluded by .gitignore)
git add .

# Commit if there are staged changes
if git diff --cached --quiet; then
  echo "   (nothing new to commit — repo already up to date)"
else
  git commit -m "Initial commit — ASC Workflow"
  echo "   ✓ committed"
fi

# ── Step 2: GitHub ────────────────────────────────────────────────────────────
echo ""
echo "▶  Step 2 — Creating private GitHub repo and pushing..."

# Check for gh CLI
if ! command -v gh &>/dev/null; then
  echo ""
  echo "  ✗  GitHub CLI (gh) not found."
  echo "     Install it with:  brew install gh"
  echo "     Then run:         gh auth login"
  echo "     Then re-run this script."
  exit 1
fi

# Authenticate if not already
if ! gh auth status &>/dev/null; then
  echo "   Launching GitHub authentication..."
  gh auth login
fi

# Create private repo (skip if it already exists)
if gh repo view "$REPO_NAME" &>/dev/null 2>&1; then
  echo "   (repo '$REPO_NAME' already exists — skipping creation)"
else
  gh repo create "$REPO_NAME" --private --source=. --remote=origin
  echo "   ✓ private repo created: github.com/$(gh api user --jq .login)/$REPO_NAME"
fi

# Push
git push -u origin main
echo "   ✓ code pushed to GitHub"

# ── Done — Next steps ─────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Git push complete!  Now complete Railway setup:    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  1. Go to https://railway.com → New Project"
echo "     → Deploy from GitHub repo → select 'asc-workflow'"
echo "     → Choose Node (no extra services)"
echo ""
echo "  2. Under Settings → Variables, add these 4 vars:"
echo ""
echo "     ANTHROPIC_API_KEY  = (your key from .env)"
echo "     PORTAL_PASSWORD    = ASCadvisors2026"
echo "     COOKIE_SECRET      = asc_workflow_secret_2026"
echo "     NODE_ENV           = production"
echo ""
echo "  3. Under Settings → Networking → Generate Domain"
echo "     Copy the Railway URL and verify login works."
echo ""
echo "  4. In cPanel Zone Editor for asquareconsultancy.us:"
echo "     Add CNAME:  app  →  <your-railway-domain>.railway.app"
echo ""
echo "  5. Back in Railway: Settings → Custom Domain"
echo "     Add:  app.asquareconsultancy.us"
echo ""
echo "  All done — your app will be live at app.asquareconsultancy.us"
echo ""
