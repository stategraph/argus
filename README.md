# Argus

Fast GitHub Pull Requests.

![Screenshot](screenshot.png)

## Why this exists

GitHub pull requests used to be fast. You loaded a page, saw the diff, reviewed the change.

Now the PR screen is a heavy client-side app optimizing for interaction density, not understanding code. Large diffs are slow. Context is fragmented. Force-pushes invalidate reviews. You spend more time fighting the UI than reading code.

This fixes that.

## What it does differently

- **Server-rendered HTML** - Content loads immediately. No hydration wall.
- **Explicit refresh** - PR updates? You're told. You choose when to reload. No surprise reflows.
- **Small DOM, large PRs** - Files collapse by default. Diffs chunk on demand.
- **Keyboard-first** - Navigate files, toggle diffs, comment—all from the keyboard.
- **GitHub stays authoritative** - Reads/writes through GitHub API. Comments land on GitHub.

This is not a new workflow. It's a better screen.

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
