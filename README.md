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

`pnpm check` runs Biome, separate TypeScript checks, fixture-based Vitest tests, the Rslib Action build, the Rsbuild dashboard build, and a smoke test of the bundled Action. Tests use synthetic GitHub responses and require no PAT. The smoke harness is development-only; there is no supported standalone CLI.

Generated files live in ignored `dist/`. The development branch does not track compiled Action JavaScript. See [contributor guidance](AGENTS.md) for architecture and release requirements.
