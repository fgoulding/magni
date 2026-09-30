<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design system

Before writing or changing any UI, read `docs/design-system.md`. It defines the
brand colors, semantic tokens, typography, and component patterns. Use the
semantic Tailwind tokens (`bg-brand`, `text-muted`, `border-line`, `.card`,
`.display`, `.eyebrow`) — never raw `zinc-*`/`amber-*`/hex. Verify visual changes
by screenshotting the running app at the iPhone viewport, not by eyeballing code.

# Magni engineering team

For substantive Magni work, use the reusable team and dependency workflow in
`docs/engineering/team.md`. Project agent definitions are in `.codex/agents/`:
coordinator, researching designer, frontend, backend and independent verification.
The primary agent may coordinate; delegate bounded independent work with explicit
file ownership and respect the runtime concurrency limit. Keep decisions and
evidence in the task plan so work can resume across sessions. Fetch and compare
the remote before editing; preserve unrelated local work.
