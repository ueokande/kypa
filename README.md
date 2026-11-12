# Kypa

**Keep Your Policies Aligned**

Kypa is an OSS tool in development for scanning resource configuration against custom organizational policies, starting with GitHub Enterprise Cloud repositories.

Run scans centrally without installing workflows in each target repository. A PAT collects accessible files and settings; a static HTML dashboard presents the latest results on any static host, with access controls configured separately. GitHub Pages is one deployment option.

**Status:** An initial TypeScript implementation is available in source, but no Action release has been published. Version tags shown in the manual are illustrative. No OSS license has been selected.

- [User manual](docs/README.md)
- [Contributor guidance](AGENTS.md)

## Development

Use Node.js 24 LTS and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs Biome, separate TypeScript checks, fixture-based Vitest tests, the Rslib Action and CLI builds, the Rsbuild dashboard build, and smoke tests of both entry points. Tests use synthetic GitHub responses and require no PAT.

Generated files live in ignored `dist/`. The development branch does not track compiled Action JavaScript. See [contributor guidance](AGENTS.md) for architecture and release requirements.

## Local scans

After building, run the private CLI from this checkout with `GH_TOKEN` (or `GITHUB_TOKEN`) set in your environment:

```sh
pnpm build
pnpm cli --config ./kypa.yaml
```

Run `pnpm cli --help` for options. See [local execution](docs/local-execution.md) for policy setup, reports, and exit codes. The CLI is not distributed through npm.
