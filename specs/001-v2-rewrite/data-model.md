# Data Model: npmdata v2

**Date**: 2026-03-08  
**Branch**: `001-v2-rewrite`

---

## Entities

### 1. PackageConfig

Internal parsed representation of an npm package specifier. Never appears as a nested key in config files — config files use a flat string.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | npm package name (e.g. `my-pkg`) |
| `version` | `string` | No | Semver range constraint (e.g. `^1.2.3`). Absent means "latest". |

**Config file representation**: Flat string `"my-pkg@^1.2.3"` or `"my-pkg"`. Parsed by `parsePackageSpec()` into `PackageConfig`.

---

### 2. SelectorConfig

Controls which files are selected from a package and install behaviour.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `files` | `string[]` | No | `DEFAULT_FILENAME_PATTERNS` | Glob patterns; files must match at least one. Default excludes `package.json`, `bin/**`, `README.md`, `node_modules/**`. |
| `contentRegexes` | `string[]` | No | `[]` | Regex strings; files must match at least one. Binary files always skip regex check. |
| `presets` | `string[]` | No | `[]` | Tags this entry for `--presets` CLI filtering. Not forwarded to dependency packages. |
| `upgrade` | `boolean` | No | `false` | Force fresh package install even if a satisfying version is installed. |

**Merge rule (across recursion levels)**: `files` ANDed; `contentRegexes` ANDed; `presets` NOT inherited; `upgrade` not merged (each level evaluated independently).

---

### 3. OutputConfig

Controls where and how extracted files are written.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | `string` | Yes | — | Output directory relative to cwd. Concatenated across recursion levels: `<cli>/<pkg1>/<pkg2>`. |
| `force` | `boolean` | No | `false` | Overwrite existing unmanaged files. Takes precedence is overridden by `--force` and `--keep-existing`. |
| `keepExisting` | `boolean` | No | `false` | Skip files that already exist; create missing ones. Cannot combine with `force`. |
| `gitignore` | `boolean` | No | `true` | Create/update `.gitignore` alongside each `.npmdata` marker. |
| `unmanaged` | `boolean` | No | `false` | Write without `.npmdata` marker, no gitignore update, no read-only. Existing files skipped. Takes precedence over `force`. |
| `dryRun` | `boolean` | No | `false` | Report what would change; no disk writes. |
| `symlinks` | `SymlinkConfig[]` | No | `[]` | Post-extract symlink operations. Appended across recursion levels. |
| `contentReplacements` | `ContentReplacementConfig[]` | No | `[]` | Post-extract content replacements. Appended across recursion levels. |

**Merge rule (caller overrides child)**: `force`, `keepExisting`, `gitignore`, `unmanaged`, `dryRun` use caller value when set; `path` concatenated; `symlinks` and `contentReplacements` appended.

---

### 4. ExecutionConfig

Controls runtime output verbosity. Internal grouping type only — never a nested key in config files; `silent` and `verbose` are root-level on each entry.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `silent` | `boolean` | No | `false` | Suppress per-file output; print only final summary line. |
| `verbose` | `boolean` | No | `false` | Print detailed step information, resolved paths, intermediate decisions. |

---

### 5. SymlinkConfig

Defines one post-extract symlink operation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | `string` | Yes | Glob relative to outputDir. Matching files/dirs get symlinked into `target`. |
| `target` | `string` | Yes | Directory where symlinks are created, relative to outputDir. Supports `../` paths. |

**Stale symlink removal**: During `extract`, symlinks pointing into outputDir that no longer match source are removed. During `purge`, ALL symlinks pointing into the purged outputDir are removed.

---

### 6. ContentReplacementConfig

Defines one post-extract content replacement operation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | `string` | Yes | Glob relative to cwd selecting workspace files to modify. |
| `match` | `string` | Yes | Regex string; all non-overlapping occurrences replaced (global flag applied). |
| `replace` | `string` | Yes | Replacement string; may contain back-references (`$1`, `$2`). |

**check behaviour**: The same replacements are applied to package source content before hash comparison (FR-081) so replaced files are not falsely reported as modified.

---

### 7. NpmdataExtractEntry

One entry in the `npmdata.sets` array. Represents a single extraction target.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `package` | `string` | Yes | Flat package spec string (`"my-pkg@^1.2.3"`). Parsed to `PackageConfig` internally. |
| `output` | `OutputConfig` | Yes | Where/how to write files. |
| `selector` | `SelectorConfig` | No | Which files to select and install options. |
| `silent` | `boolean` | No | Root-level (not nested under `execution`). |
| `verbose` | `boolean` | No | Root-level (not nested under `execution`). |

---

### 8. NpmdataConfig

Top-level structure stored under `npmdata` key in `package.json` or in any cosmiconfig source.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sets` | `NpmdataExtractEntry[]` | Yes | All extraction entries. |
| `postExtractScript` | `string` | No | Shell command run after successful `extract` (not during `--dry-run`). Executed in `process.cwd()`. Full argv appended as arguments. |

---

### 9. ExtractionMap (Diff Phase Output)

Internal read-only structure produced by `fileset/diff.ts`. Not persisted.

| Field | Type | Description |
|-------|------|-------------|
| `toAdd` | `FileOperation[]` | Files present in package source but absent from outputDir. |
| `toModify` | `FileOperation[]` | Files whose hash differs between package source and outputDir. |
| `toDelete` | `string[]` | Relative paths of managed files no longer present in filtered package source. |
| `toSkip` | `SkippedFile[]` | Files skipped (unmanaged conflict, keepExisting, etc.) with reason. |
| `conflicts` | `ConflictFile[]` | Unmanaged files in outputDir that block extraction (when `force` and `unmanaged` are both false). |

`FileOperation`: `{ relPath: string, sourcePath: string, destPath: string, hash: string }`  
`SkippedFile`: `{ relPath: string, reason: 'conflict' | 'keep-existing' | 'unmanaged' }`  
`ConflictFile`: `{ relPath: string, existingOwner?: string }` — `existingOwner` set when file is managed by a different package.

---

### 10. ManagedFileMetadata

One row in a `.npmdata` CSV marker file.

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | Relative path from marker file directory. |
| `packageName` | `string` | Source npm package name. |
| `packageVersion` | `string` | Installed version at extraction time. |

**CSV format** (preserved from v1): `path,packageName,packageVersion` — one row per file, no header row.

---

### 11. ProgressEvent

Emitted by extract/check/purge for UI progress reporting (FR-100).

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end'; packageName: string; packageVersion: string }
  | { type: 'file-added'; packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted'; packageName: string; file: string }
  | { type: 'file-skipped'; packageName: string; file: string };
```

---

## State Transitions

### Managed File Lifecycle

```
[absent]
    |-- extract (no conflict) --> [managed, read-only]
    |-- extract --managed=false  --> [written, not tracked]

[managed, read-only]
    |-- extract (updated)    --> [managed, read-only, new content]
    |-- purge                --> [absent]
    |-- extract (removed from pkg) --> [absent, deleted at end of run]

[written, not tracked]
    |-- extract (no --managed=false, no --force) --> CONFLICT, abort
    |-- extract --force      --> [managed, read-only]
    |-- extract --managed=false  --> [skipped, left in place]
```

### .npmdata Marker Lifecycle

```
[none] -- extract --> [marker created with all managed file rows]
[marker] -- extract (incremental) --> [marker updated: add/remove rows]
[marker] -- purge --> [marker deleted if no remaining managed files]
[marker] -- manually deleted --> [on next extract: prior managed files treated as unmanaged]
```

---

## Validation Rules

| Rule | Description |
|------|-------------|
| `force` + `keepExisting` | Mutually exclusive; tool exits with validation error before any work |
| `force` + `unmanaged` | `unmanaged` takes precedence; no conflict error; existing files not overwritten |
| Circular dependency | Detected by tracking in-flight package names; tool exits non-zero with cycle description |
| Output path conflict | Same output path from two different leaf packages without `--force` → report conflict, abort |
| Package not installed | `check` on unextracted package → exit non-zero with "Run 'extract' first" message |
| `--dry-run` | No disk writes; `postExtractScript` not executed |
