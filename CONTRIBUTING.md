# Contributing

Contributions are welcome.

Start with the contributor guide in the docs:

- [docs/contributing.mdx](docs/contributing.mdx)

## Contributor License Agreement

Before we can accept outside contributions, contributors must agree to the
Second Contributor License Agreement. This keeps the project legally clear and
preserves Second's ability to relicense future versions if the project needs to
change direction later.

Do not merge outside pull requests until the CLA check is configured and passing
for the contributor.

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
