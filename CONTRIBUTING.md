# Contributing

Contributions are welcome.

Start with the contributor guide in the docs:

- [docs/contributing.mdx](docs/contributing.mdx)

Before opening a pull request, run the checks that match your change:

```bash
npm run typecheck
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm --prefix packages/cli run build
```

For documentation changes:

```bash
cd docs
mint validate
```

Keep changes focused, update docs when behavior changes, and preserve workspace
isolation for any route, repository, worker, realtime, integration, or generated
app data change.

Report security issues privately. See [SECURITY.md](SECURITY.md).
