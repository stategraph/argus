# Argus

**A fast, server-rendered interface for GitHub pull requests.**

![Screenshot](screenshot.png)

## Why it exists

GitHub's PR page is slow. Sometimes it takes forever to load.

This is a server-rendered alternative that loads pull requests immediately.

## What you get

- **Static rendering** - Server-rendered HTML that shows up instantly, every time. No client-side hydration.
- **Fast for large diffs** - Smart chunking and collapsible files. No waiting for the client to render thousands of lines.
- **Control over updates** - Get notified when PRs change, reload when you're ready. No surprise reflows.
- **Keyboard navigation** - Browse files, toggle diffs, and comment without the mouse.
- **Works with GitHub** - All comments, reviews, and merges sync through the GitHub API. Your workflow stays intact.

## Quick Start

1. **Get a GitHub token** at [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
   - Grant permissions: **Pull requests** (Read/Write), **Contents** (Read), **Commit statuses** (Read)

2. **Run it:**
   ```bash
   export GITHUB_TOKEN=github_pat_your_token_here
   npm install
   npm run migrate
   npm run dev
   ```

3. **Open** http://localhost:3000

## Run With Docker

```bash
echo "GITHUB_TOKEN=github_pat_your_token_here" > .env
docker compose up
```

---

Built with [Claude Code](https://claude.com/claude-code). Provided "as is" without warranty.

MIT License
