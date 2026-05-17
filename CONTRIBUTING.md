# Contributing

Thanks for your interest in contributing to Second! Bug fixes, new features, and docs improvements are all welcome.

For full details on architecture, local dev setup, and project conventions, see the contributor guide:

- [docs/contributing.mdx](docs/contributing.mdx)

## Contribution License

By submitting a pull request, you agree that your contribution is provided under
the Apache License 2.0, the same license as this repository.

We may add a lightweight Contributor License Agreement check later. If that
check is enabled before your pull request is merged, you may need to complete it
before merge.

## Before You Open a PR

Run the checks that match your change:

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

## Security

Report security issues privately. See [SECURITY.md](SECURITY.md).

---

Questions? Open an issue or start a discussion. We're happy to help you get oriented.
