<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Type checking

Run `npm run typecheck` from the repo root to check both `apps/web` and `apps/worker`. Do this after making changes to verify nothing is broken. Do NOT run `tsc` directly or use `node -e "require('typescript')"` — TypeScript is installed per-package, not at the root.
