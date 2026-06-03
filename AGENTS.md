<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

Before writing or changing any UI, read `docs/design-system.md`. It defines the
brand colors, semantic tokens, typography, and component patterns. Use the
semantic Tailwind tokens (`bg-brand`, `text-muted`, `border-line`, `.card`,
`.display`, `.eyebrow`) — never raw `zinc-*`/`amber-*`/hex. Verify visual changes
by screenshotting the running app at the iPhone viewport, not by eyeballing code.
