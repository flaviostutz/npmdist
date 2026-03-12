# _local-edr-001: Project semantics and structure

## Context and Problem Statement

npmdata is a utility for publishing, extracting, and synchronising files via npm packages. It can be used as a library, as a standalone CLI, or as a self-installable data package. Developers and AI agents need a clear reference for the domain concepts, folder layout, and coding standards that govern this project.

What are the core concepts, folder structure, usage modes, and coding standards that must be followed?

## Decision Outcome

**Documented domain model, folder layout, usage modes, and coding standards**

A single authoritative reference ensures consistent implementation decisions across the codebase.

### Implementation Details

**Core concepts**

- **Package** - An npm package containing data files intended to be published to an npm registry and later extracted into a consumer's directory. A package may include an `npmdata` configuration (in `package.json` or `.npmdatarc`) describing how its files should be extracted and which other data packages it depends on.
- **Fileset** - A combination of a package spec (name + optional semver constraint) and instructions that control which files are selected (glob patterns, content regexes, presets) and how they are written to disk (output path, force, keepExisting, unmanaged, gitignore, symlinks, content replacements).
- **CLI** - The command-line interface (`npx npmdata`) that orchestrates extract, check, list, purge, and init operations. It can be configured via `.npmdatarc`, `package.json#npmdata`, or direct command-line arguments.

**Usage modes**

1. **Library** - Embed npmdata in another system by importing its public API (e.g. `extract()`, `check()`, `list()`, `purge()`).
2. **Standalone CLI** - Run `npx npmdata` with flags or a `.npmdatarc` config file to extract data from any npm package.
3. **Self-installable package** - Use `npmdata init` to scaffold a publishable package that bundles its own CLI entry-point so consumers run `npx <your-package>` to extract data, optionally filtered by `--presets`.

**Folder layout**

```
/lib/src
  /cli/         CLI entry-points (argument parsing, help text, config loading)
  /package/     Package-level orchestration (config resolution, fileset iteration, purge coordination)
  /fileset/     File-level extraction, check, and sync logic
  /types.ts     Shared types and constants
  /utils.ts     Low-level utilities
  /index.ts     Public API surface

/examples
  /mypackage              Self-exportable data package example
  /mypackage-consumer     Consumer of the self-exportable package
  /cli-config             CLI usage with .npmdatarc configuration
  /split-set-config       Split-set pattern: same package in two sets, excluding a file in one and including it with different output config in the other, using .npmdatarc
```

**Coding standards**

- Files must not exceed 400 lines. When a file grows beyond this, split related functions into separate modules.
- Apply the Template Method pattern when a function's main logic has well-defined sections individually larger than 20 lines; extract each section into its own function.
- Always keep `README.md`, unit tests, and `examples` resources in sync with implementation changes.
- Keep test files near the tested resources, with similar file name as the file that has the resource being tested. For example, `app.test.ts` with tests for resources in `app.ts`.
- Types should be declared in the same file that they are used if those types are not reused anywhere else

**Tooling**

- Use make build, make lint-fix and make test by default at the end of all changes to check if everything is ok
- We use PNPM in this repo
