# Second Web App

This is the Next.js application for Second. It owns the workspace UI, API routes,
auth/session handling, MongoDB persistence, app preview API, audit logs, and the
web-to-worker bridge.

Run the app through the repository root scripts instead of this directory:

```bash
npm run dev
npm run typecheck
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

`npm run dev` writes the current local URL to `.second-dev.txt` in the repo
root. Use that URL instead of assuming `localhost:3000`.
