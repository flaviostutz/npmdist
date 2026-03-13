# Research: npmdata v2 Clean-room Reimplementation

**Date**: 2026-03-08  
**Branch**: `001-v2-rewrite`  
**Source**: Direct analysis of `lib/` v1 codebase, `lib/spec.md`, and `specs/001-v2-rewrite/spec.md`

---

## 1. Toolchain & Build

### Decision
Use identical toolchain to v1 (`lib/`): TypeScript 5.x strict, CommonJS output, pnpm, esbuild (bundler), esbuild-jest (test transformer), Jest 29, @stutzlab/eslint-config.

### Rationale
- Eliminates tooling risk; v1 toolchain is proven and already configured.
- `esbuild-jest` is dramatically faster than `ts-jest` for the test suite size.
- Constitution § Development Standards explicitly mandates TypeScript strict + pnpm.

### Alternatives Considered
- `ts-jest`: Slower compilation per file; no advantage for this project size.
- ESM output: Node.js CJS is required by `require.resolve()` in `runner.ts` and cosmiconfig native loaders.

---

## 2. In-Process vs Subprocess Execution Model

### Decision
v2 executes all fileset operations as direct in-process function calls. No subprocess is spawned per entry (FR-004). `package/action-*.ts` files import and call `fileset/diff.ts` / `fileset/execute.ts` directly.

### Rationale
- v1 spawns a full CLI subprocess per entry (see `package/commands.ts` `buildExtractCommand`, `buildCheckCommand`, etc.), which requires stdout-parsing for result aggregation, makes the two-phase model impossible across entries, and is fragile when output format changes.
- In-process calls allow the diff phase to collect the full ExtractionMap across all filesets before any disk write occurs, enabling correct deferred-deletion semantics (FR-012).
- Each layer becomes independently unit-testable without running a child process.

### Alternatives Considered
- Worker threads: Adds complexity with no benefit; operations are I/O-bound not CPU-bound.
- Keeping subprocess model: Directly contradicted by FR-004 and makes FR-010/FR-012 impossible.

---

## 3. Two-Phase Diff/Execute Model — Implementation Pattern

### Decision
- **Phase 1 (`fileset/diff.ts`)**: Pure function, reads package files and output dir state, returns `ExtractionMap` (typed as `{ toAdd, toModify, toDelete, toSkip }`). No disk I/O writes.
- **Phase 2 (`fileset/execute.ts`)**: Receives `ExtractionMap`, performs all disk writes. Returns result summary.
- `action-extract.ts` calls diff for all filesets first, then executes. Deletions are deferred until all filesets complete (FR-012).

### Rationale
Matches `lib/spec.md` pseudo-algorithm exactly. Enables `check`, `list`, `purge` to reuse diff result without re-reading package files (FR-011).

---

## 4. Config Schema — v2 Breaking Changes from v1

### Decision
v2 uses a new config schema. `presets` and `upgrade` move from root-level entry fields (v1) into the nested `selector` sub-object. `silent` and `verbose` remain root-level (same as v1). No backward compatibility maintained.

### Rationale
Clarification session 2026-03-08 Q1: v2 intentionally breaks v1 schema; clean-room rewrite scope.

### v2 Config File Shape (in `.npmdatarc` / `package.json#npmdata`)
```json
{
  "sets": [
    {
      "package": "my-pkg@^1.2.3",
      "output": {
        "path": "./data",
        "force": false,
        "keepExisting": false,
        "gitignore": true,
        "unmanaged": false,
        "dryRun": false,
        "symlinks": [],
        "contentReplacements": []
      },
      "selector": {
        "files": ["docs/**", "*.md"],
        "contentRegexes": ["<!-- include -->"],
        "presets": ["basic"],
        "upgrade": false
      },
      "silent": false,
      "verbose": false
    }
  ],
  "postExtractScript": "node scripts/post.js"
}
```

### v1 vs v2 Schema Diff
| Field | v1 location | v2 location |
|-------|-------------|-------------|
| `presets` | root entry field | `selector.presets` |
| `upgrade` | root entry field | `selector.upgrade` |
| `files` | `selector.files` | `selector.files` (same) |
| `contentRegexes` | `selector.contentRegexes` | `selector.contentRegexes` (same) |
| `silent`, `verbose` | root entry field | root entry field (same) |
| `output.*` | `output.*` | `output.*` (same) |

### Migration Example (v1 → v2 config schema)

**v1 `.npmdatarc` (no longer valid in v2)**:
```json
{
  "sets": [
    {
      "package": "my-pkg@^1.2.3",
      "output": { "path": "./data" },
      "selector": { "files": ["docs/**"] },
      "presets": ["basic"],
      "upgrade": false,
      "silent": false
    }
  ]
}
```

**v2 `.npmdatarc` (correct)**:
```json
{
  "sets": [
    {
      "package": "my-pkg@^1.2.3",
      "output": { "path": "./data" },
      "selector": {
        "files": ["docs/**"],
        "presets": ["basic"],
        "upgrade": false
      },
      "silent": false
    }
  ]
}
```

**What changed**: `presets` and `upgrade` moved from the root entry level into the nested `selector` object. All other fields remain in the same location.

---

## 5. Config Discovery

### Decision
Use cosmiconfig with the same search order as v1: `.npmdatarc`, `.npmdatarc.json`, `.npmdatarc.yaml`, `.npmdatarc.js`, `npmdata.config.js`, and `npmdata` key in `package.json`.

### Rationale
Clarification session 2026-03-08 Q5. Constitution § Development Standards mandates cosmiconfig as the authoritative config mechanism.

---

## 6. Preset Filtering Semantics

### Decision
- When `--presets` is absent: all entries are processed.
- When `--presets basic,extended` is present: only entries whose `selector.presets` overlaps with the requested list are processed.
- `presets` tags only the local entry; the values are never forwarded to dependency packages.
- `list` ignores preset filtering (always shows all); `check`, `extract`, `purge` all respect `--presets`.

### Rationale
Clarification session 2026-03-08 Q2 (no-filter = all) + Q2 from second session (list igores presets; purge respects). Matches v1 `filterEntriesByPresets` implementation.

---

## 7. postExtractScript Working Directory

### Decision
Always `process.cwd()` (the CLI invocation directory). Never a fileset output path.

### Rationale
Clarification session 2026-03-08 Q3. Stable, predictable cwd independent of fileset count or output path variation. v1 `runPostExtractScript` passes `runCwd` which is `parsedOutput ? path.resolve(cwd, parsedOutput) : process.cwd()` — in the multi-fileset case this reduces to `process.cwd()` when no `--output` flag is given, matching our decision.

### ⚠️ Breaking Change for v1 Consumers
In v1, when `--output` (a non-cwd output path) was provided AND `postExtractScript` was set, the script ran in the resolved output directory, not the CLI invocation directory. In v2, `postExtractScript` always runs in `process.cwd()` regardless of the `--output` value. **Consumers using `postExtractScript` with a non-default `--output` path must update their scripts** to not rely on the working directory being the output directory.

---

## 8. Partial Rollback Scope

### Decision
On extraction failure, newly created files from ALL filesets processed in the current invocation are deleted. Files that overwrote pre-existing managed files are left in their new state.

### Rationale
Clarification session 2026-03-08 Q4. Consistent: a failed run leaves no partially-applied state from any fileset.

### Implementation
`action-extract.ts` maintains a `Set<string>` of newly-created file paths (did not exist on disk before this invocation). On any unhandled error, it iterates the set and deletes each path.

---

## 9. Self-Installable Runner No-Config Fallback

### Decision
When the hosting package has no `npmdata.sets`, `run()` falls back to `[{ package: pkg.name, output: { path: '.' } }]`.

### Rationale
Clarification session 2026-03-08 Q3 (second session). This is what makes `npx <package-name>` work with zero config. Matches v1 `runner.ts` lines 138–142.

---

## 10. check + unmanaged Behaviour

### Decision
`check` silently skips entries where `output.unmanaged === true` or `--managed=false` flag is set. `--managed=false` is accepted as a valid `check` flag.

### Rationale
Clarification session 2026-03-08 Q1 (second session). Checking unmanaged files is meaningless (no marker, no read-only enforcement). Matches v1 `action-check.ts` `managedEntries` filter.

---

## 11. purge + Symlink Cleanup

### Decision
`purge` removes: (1) all managed files for targeted entries, (2) all symlinks pointing into the purged output directory, (3) empty directories left behind.

### Rationale
Clarification session 2026-03-08 Q5 (second session). Dangling symlinks after purge are inconsistent. Matches intent of v1 `action-purge.ts` which imports `applySymlinks`.

---

## 12. .npmdata Marker File Format

### Decision
Preserve v1 CSV format exactly: one row per managed file, fields: `path,packageName,packageVersion`. This preserves compatibility with existing consumer marker files.

### Rationale
Assumption in spec.md (Assumptions section). Format defined in `lib/src/fileset/markers.ts`.

---

## 13. Test Strategy

### Decision
Reuse v1 test strategy verbatim:
- `*.test.ts` files co-located with source.
- `installMockPackage(name, files, tmpDir)` helper in `fileset/test-utils.ts`: creates a tar.gz of a synthetic package, installs it into a tmpDir via `pnpm add`, then tests call real extraction functions against it.
- `beforeEach`/`afterEach` with `fs.mkdtempSync` + `fs.rmSync` for isolation.
- Diff phase (`fileset/diff.ts`) tests are written independently from execute phase (`fileset/execute.ts`) tests, satisfying SC-006.

### Rationale
Constitution Principle III mandates test-first. v1 strategy is proven and realistic (real pnpm installs, no mocks of the file system).

---

## 14. Binary File Handling

### Decision
Binary files are copied as-is. Content-regex filtering skips binary files. Detection follows same heuristic as v1 (null-byte scan in first 8 KB).

### Rationale
Spec Assumptions section. No change needed from v1 behaviour.

---

## 15. Default File Filter

### Decision
When no `selector.files` is specified, apply: `['**', '!package.json', '!bin/**', '!README.md', '!node_modules/**']`.

### Rationale
FR-090. Matches `DEFAULT_FILENAME_PATTERNS` constant in v1 `lib/src/types.ts`.
