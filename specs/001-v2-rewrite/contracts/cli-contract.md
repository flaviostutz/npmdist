# CLI Contract: npmdata v2

**Date**: 2026-03-08  
**Branch**: `001-v2-rewrite`

This document defines the complete CLI surface exposed by the `npmdata` binary. It is the authoritative contract for argument parsing, default values, exit codes, and output streams.

---

## Global Conventions

| Convention | Value |
|------------|-------|
| Default command | `extract` — when no command is given or the first arg starts with `-` |
| Help flag | `--help` — prints usage for the active command; exits 0 |
| Version flag | `--version` — prints package version; exits 0 |
| Success exit code | `0` |
| Failure exit code | `1` (or the child process's exit code when propagating) |
| Error stream | stderr |
| Progress/summary stream | stdout |
| Config discovery | cosmiconfig: `.npmdatarc`, `.npmdatarc.json`, `.npmdatarc.yaml`, `.npmdatarc.js`, `npmdata.config.js`, `npmdata` key in `package.json` |
| Flag precedence | CLI flags override all config file values |

---

## Commands

### `extract` (default)

Extract files from one or more npm packages into a local output directory.

```
npmdata [extract] [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--packages` | | `string` | — | Comma-separated package specs (e.g. `my-pkg@^1.2.3`). Overrides config file `sets`. |
| `--output` | `-o` | `string` | — | Output directory path. Required when `--packages` is used. |
| `--files` | | `string` | — | Comma-separated glob patterns for file selection. |
| `--content-regex` | | `string` | — | Comma-separated regex strings for content filtering. |
| `--force` | | `boolean` | `undefined` | Overwrite existing unmanaged files. |
| `--keep-existing` | | `boolean` | `undefined` | Skip files that already exist; create missing ones. Mutually exclusive with `--force`. |
| `--gitignore` | | `boolean` | `undefined` | Disable `.gitignore` update alongside each marker when set to `false`. |
| `--managed` | | `boolean` | `undefined` | Write without `.npmdata` marker; no gitignore; no read-only when set to `false`. Skips existing files. |
| `--dry-run` | | `boolean` | `undefined` | Report changes without writing to disk. |
| `--upgrade` | | `boolean` | `undefined` | Force fresh package install even if a satisfying version is installed. |
| `--presets` | | `string` | — | Comma-separated preset tags; only matching entries are processed. |
| `--silent` | | `boolean` | `undefined` | Suppress per-file output; print only final summary line. |
| `--verbose` | `-v` | `boolean` | `undefined` | Print detailed step information. |

**Exit codes**:
- `0` — extraction complete (including dry-run with no errors)
- `1` — validation error, conflict, install failure, or write error

**Partial rollback on failure**: Newly created files (did not exist before run) are deleted across all filesets. Overwritten managed files are left in new state.

**postExtractScript**: Executed after successful extract (not on dry-run) in `process.cwd()` with full user argv appended.

---

### `check`

Verify that locally extracted files match their package sources.

```
npmdata check [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--packages` | | `string` | — | Comma-separated package specs. Overrides config file `sets`. |
| `--output` | `-o` | `string` | — | Output directory path. |
| `--files` | | `string` | — | Glob patterns for file selection. |
| `--content-regex` | | `string` | — | Regex strings for content filtering. |
| `--managed` | | `boolean` | `undefined` | Silently skip unmanaged entries when set to `false` (meaningless to check). |
| `--presets` | | `string` | — | Comma-separated preset tags; only matching entries are checked. |
| `--verbose` | `-v` | `boolean` | `undefined` | Print detailed comparison information. |

**Exit codes**:
- `0` — all managed files in sync
- `1` — any file missing, modified, or extra (present in filtered source but not extracted)

**Drift categories reported**:
- `missing` — in `.npmdata` marker but absent from output dir
- `modified` — content hash differs from package source (after applying contentReplacements)
- `extra` — in filtered package source but never extracted (not in marker or output dir)

**Unextracted packages**: If the target package is not installed locally, exits non-zero with: `"Package <name> is not installed. Run 'extract' first."`

---

### `list`

Print all files currently managed by npmdata in the output directory.

```
npmdata list [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--output` | `-o` | `string` | — | Output directory to inspect. |
| `--verbose` | `-v` | `boolean` | `false` | Print additional metadata per file. |

**Note**: `list` ignores `--presets`; it always reports all managed files regardless of preset tags.

**Exit codes**:
- `0` — always (even when no managed files found)

**Output format**: One line per managed file: `<relPath>  <packageName>@<packageVersion>`

---

### `purge`

Remove all managed files from the output directory.

```
npmdata purge [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--packages` | | `string` | — | Comma-separated package specs. Limits purge to matching entries. |
| `--output` | `-o` | `string` | — | Output directory to purge. |
| `--presets` | | `string` | — | Comma-separated preset tags; only matching entries are purged. |
| `--dry-run` | | `boolean` | `false` | Print what would be removed without deleting. |
| `--silent` | | `boolean` | `false` | Suppress per-file output. |
| `--verbose` | `-v` | `boolean` | `false` | Print detailed deletion steps. |

**Actions on purge**:
1. Delete all managed files for targeted entries.
2. Remove all symlinks pointing into the purged output directory.
3. Remove empty directories left behind.
4. Remove `.npmdata` marker file if no remaining managed files.
5. Remove corresponding `.gitignore` entries (or file if now empty).

**Exit codes**:
- `0` — purge complete (including dry-run)
- `1` — error during deletion

---

### `init`

Scaffold a new publishable npm data package.

```
npmdata init [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--output` | `-o` | `string` | `.` | Directory to scaffold into (default: current dir). |
| `--verbose` | `-v` | `boolean` | `false` | Print scaffolding steps. |

**Created files**:
- `package.json` — with `name`, `version: "1.0.0"`, `bin` pointing to `bin/npmdata.js`, `files` array including `bin/` and `data/`.
- `bin/npmdata.js` — minimal shim calling `require('npmdata').run(__dirname)`.

**Exit codes**:
- `0` — scaffolding complete
- `1` — target directory already has conflicting files

---

## Self-Installable Package Runner (`run()`)

Published packages generated by `init` expose a `run(binDir, argv)` function via their bin shim.

```
npx <package-name> [extract|check|list|purge] [flags]
```

The runner:
1. Reads `npmdata.sets` from the hosting package's `package.json` (sibling of `bin/`).
2. Falls back to `[{ package: pkg.name, output: { path: '.' } }]` when `sets` is absent.
3. Dispatches to the same action handlers as the CLI (`extract`, `check`, `list`, `purge`).
4. Supports all the same flags as the CLI for each action.
5. Does NOT support `init` (no recursive scaffold).

---

## Mutual Exclusivity and Validation Errors

| Combination | Behaviour |
|-------------|-----------|
| `--force` + `--keep-existing` | Validation error before any work; exit 1 |
| `--force` + `--managed=false` | `--managed=false` takes precedence; no error |
| `--dry-run` ignores `postExtractScript` | Script is never executed during dry-run |
| `--packages` overrides config file `sets` | Config file sets entirely replaced by `--packages` value |

---

## Exit Code Summary

| Exit Code | Meaning |
|-----------|---------|
| `0` | Success |
| `1` | Any error (validation, conflict, install failure, I/O error, drift detected by check) |
