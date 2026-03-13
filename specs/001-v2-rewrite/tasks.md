# Tasks: npmdata v2 — Clean-room Reimplementation

**Input**: Design documents from `specs/001-v2-rewrite/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/cli-contract.md ✅, quickstart.md ✅

**Context**: Complete clean-room reimplementation in `lib/src/v2/` (new subfolder inside the existing `lib/` project). The existing v1 codebase in `lib/src/` is NOT modified. All new code lives under `lib/src/v2/` and reuses the existing `lib/` toolchain (tsconfig, jest, eslint, Makefile).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1–US7; matches spec.md priorities)
- Exact file paths are shown for each task

## Path Convention

All source paths are relative to the repository root. New v2 code lives in `lib/src/v2/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the v2 source directory skeleton and wire it into the existing `lib/` toolchain.

- [X] T001 Create full v2 source directory structure under `lib/src/v2/` (subdirs: `cli/`, `cli/commands/`, `package/`, `fileset/`)
- [X] T002 [P] Create `lib/src/v2/fileset/constants.ts` — export `MARKER_FILE = '.npmdata'` and `DEFAULT_FILENAME_PATTERNS` (exclude `package.json`, `bin/**`, `README.md`, `node_modules/**`) (FR-090)
- [X] T003 [P] Create `lib/src/v2/fileset/test-utils.ts` — implement `installMockPackage(name, version, files)` helper that creates a real tarball (using `archiver`) and installs it via pnpm, mirroring v1's `lib/src/fileset/test-utils.ts` pattern

**Checkpoint**: Directory structure exists; constants and test-utils are ready for all downstream tasks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, shared utilities, marker I/O, gitignore management, and package install/enumeration. These modules are imported by every user story — no story work can begin until this phase completes.

**⚠️ CRITICAL**: No user story phase can start until this phase is complete.

- [X] T004 Define all shared TypeScript types in `lib/src/v2/types.ts` — `PackageConfig`, `SelectorConfig`, `OutputConfig`, `ExecutionConfig`, `SymlinkConfig`, `ContentReplacementConfig`, `NpmdataExtractEntry`, `NpmdataConfig`, `ExtractionMap`, `FileOperation`, `SkippedFile`, `ConflictFile`, `ManagedFileMetadata`, `ProgressEvent` (all entities from data-model.md)
- [X] T005 [P] Implement `lib/src/v2/utils.ts` — `parsePackageSpec(spec: string): PackageConfig` (split on last `@`), `hashFile(path: string): Promise<string>` (SHA-256), `detectPackageManager(): 'pnpm' | 'npm'`, `installPackage(name: string, version: string | undefined, upgrade: boolean): Promise<string>` (runs pnpm/npm install, returns installed path)
- [X] T006 [P] Implement `lib/src/v2/utils.test.ts` — unit tests for `parsePackageSpec` (scoped packages, version absent, plain name), `hashFile`, and `detectPackageManager`
- [X] T007 [P] Implement `lib/src/v2/fileset/markers.ts` — `readMarker(markerPath: string): Promise<ManagedFileMetadata[]>`, `writeMarker(markerPath: string, entries: ManagedFileMetadata[]): Promise<void>` — CSV format: `path,packageName,packageVersion` one row per file, no header row (preserved from v1)
- [X] T008 [P] Implement `lib/src/v2/fileset/gitignore.ts` — `addToGitignore(markerDir: string, paths: string[]): Promise<void>`, `removeFromGitignore(markerDir: string, paths: string[]): Promise<void>` — create file if absent; append/remove only the managed entries
- [X] T009 [P] Implement `lib/src/v2/fileset/gitignore.test.ts` — unit tests for create-from-scratch, append to existing, remove entries, remove file when empty
- [X] T010 Implement `lib/src/v2/fileset/package-files.ts` — `installedPackagePath(name: string): string | null` (resolve from node_modules), `enumeratePackageFiles(pkgPath: string, selector: SelectorConfig): Promise<string[]>` (apply `files` glob AND `contentRegexes`; skip binary for regex; apply `DEFAULT_FILENAME_PATTERNS` when `files` is empty)
- [X] T011 Implement `lib/src/v2/fileset/package-files.test.ts` — integration tests using `installMockPackage`; verify glob filtering, regex filtering, binary passthrough, default exclusions

**Checkpoint**: Types, utilities, markers, gitignore, and package enumeration are all tested and ready. User story phases can begin.

---

## Phase 3: US6 — Configure Extraction via Config File or CLI Flags (Priority: P1)

**Goal**: cosmiconfig-based config discovery + argv parsing foundation shared by all commands.

**Independent Test**: Place a `.npmdatarc` in a temp dir, call `loadNpmdataConfig()`, verify the returned `NpmdataConfig` matches the file. Call argv helpers with raw process.argv fragments, verify correct typed output.

- [X] T012 Implement `lib/src/v2/cli/config.ts` — `loadNpmdataConfig(cwd: string): Promise<NpmdataConfig | null>` using cosmiconfig; search sources in priority order: `.npmdatarc`, `.npmdatarc.json`, `.npmdatarc.yaml`, `.npmdatarc.js`, `npmdata.config.js`, `npmdata` key in `package.json` (FR-025)
- [X] T013 [P] [US6] Implement `lib/src/v2/package/argv.ts` — helpers for parsing `--packages` (comma-split → `PackageConfig[]` via parsePackageSpec), `--output`, `--files` (comma-split), `--content-regex` (comma-split), `--presets` (comma-split), boolean flags (`--force`, `--keep-existing`, `--dry-run`, `--upgrade`, `--silent`, `--verbose`, `--managed`, `--gitignore`); validate mutually exclusive pairs (FR-042 through FR-047)
- [X] T014 [P] [US6] Implement `lib/src/v2/package/argv.test.ts` — unit tests for each flag parser, mutual exclusion validation (`--force` + `--keep-existing` = error), `--packages` overriding config sets (FR-026)
- [X] T015 [US6] Implement `lib/src/v2/cli/cli.ts` — top-level CLI router: call `loadNpmdataConfig`, detect command from argv[0] (default to `extract` when absent or starts with `-`), dispatch to appropriate command handler; handle `--help` and `--version` globally (FR-041)
- [X] T016 [P] [US6] Implement `lib/src/v2/cli/usage.ts` — `printUsage(command: string): void` generating `--help` text for each of the 5 commands from cli-contract.md (FR-047)
- [X] T017 [P] [US6] Create `lib/src/v2/cli/cli.test.ts` — unit tests for command routing (default to extract, named commands, `--help`, `--version`)
- [X] T018 [US6] Create `lib/src/v2/fileset/index.ts` re-exporting public fileset-layer API; create `lib/src/v2/package/index.ts` re-exporting public package-layer API

**Checkpoint**: Config loading and argv parsing are ready; the CLI shell can route commands. US1–US7 implementation can proceed.

---

## Phase 4: US1 — Extract Files from a Single npm Package (Priority: P1) 🎯 MVP

**Goal**: `extract` command pulls files from a package into an output directory, writes `.npmdata` marker, updates `.gitignore`, enforces read-only on managed files, supports `--dry-run`, `--force`, `--keep-existing`, `--managed=false`.

**Independent Test**: `node lib/dist/v2/main.js extract --packages my-pkg@1.0.0 --output ./output` (after `make build` in `lib/`) — verify expected files appear, `.npmdata` marker is written, files are read-only.

- [X] T019 [US1] Implement `lib/src/v2/fileset/diff.ts` — pure read-only function `diff(pkgFiles: string[], outputDir: string, selector: SelectorConfig, outputConfig: OutputConfig, existingMarker: ManagedFileMetadata[]): Promise<ExtractionMap>` — classifies each file as `toAdd`, `toModify`, `toDelete`, `toSkip`, or `conflicts` by comparing source hashes against output dir (FR-010, FR-011); NO disk writes
- [X] T020 [US1] Implement `lib/src/v2/fileset/diff.test.ts` — unit tests for diff phase **independently** of execute phase (SC-006): new file → toAdd, changed file → toModify, removed file → toDelete, unmanaged conflict → conflicts, keepExisting present → toSkip, unmanaged mode → toSkip
- [X] T021 [P] [US1] Implement `lib/src/v2/fileset/execute.ts` — `execute(map: ExtractionMap, pkgPath: string, outputDir: string, outputConfig: OutputConfig, pkg: PackageConfig): Promise<ExecuteResult>` — writes/overwrites `toAdd`+`toModify`, marks files read-only (unless unmanaged mode, FR-061), deletes `toDelete`, updates `.npmdata` marker and `.gitignore` (unless dryRun/unmanaged); returns list of files newly created in this run (for rollback)
- [X] T022 [P] [US1] Implement `lib/src/v2/fileset/execute.test.ts` — unit tests for execute phase: files written, read-only applied, marker updated, gitignore updated, dryRun no writes
- [X] T023 [US1] Implement `lib/src/v2/package/action-extract.ts` — orchestrate full extract across all filesets: (1) install packages, (2) enumerate files, (3) call diff for every fileset, (4) abort on conflicts (unless force/unmanaged), (5) execute all filesets, (6) defer deletions across all filesets until all executes complete (FR-012), (7) partial rollback on error — delete only newly created files (FR-013), (8) emit ProgressEvents (FR-100)
- [X] T024 [US1] Implement `lib/src/v2/package/action-extract.test.ts` — integration tests using `installMockPackage`: single package extract, dry-run reports but does not write, force overwrites unmanaged, keep-existing skips, unmanaged writes without marker, conflict aborts, rollback on mid-run failure
- [X] T025 [P] [US1] Implement `lib/src/v2/cli/commands/extract.ts` — `runExtract(config: NpmdataConfig | null, argv: string[]): Promise<void>` — parse argv via argv.ts, merge with config, validate mutual exclusions, call action-extract; print summary to stdout, errors to stderr; exit 1 on failure
- [X] T026 [US1] Create `lib/src/v2/main.ts` — CLI entry point: import and call `cli/cli.ts`; set `process.exitCode` on failure
- [X] T027 [US1] Create `lib/src/v2/index.ts` — public library exports: `extract`, `check`, `list`, `purge`, `run` (stubs for now; filled in later phases)

**Checkpoint**: `extract` command works end-to-end for a single package. US1 independently testable.

---

## Phase 5: US2 — Check Whether Local Files Are In Sync (Priority: P1)

**Goal**: `check` exits 0 when all managed files match source; exits 1 listing missing/modified/extra drift. Applies `contentReplacements` before comparison.

**Independent Test**: Extract, run check → exits 0. Modify a managed file, run check → exits 1 listing the modified file. Delete a managed file, run check → reports it as `missing`. Add a file to the package that was never extracted, run check → reports it as `extra`.

- [X] T028 [US2] Implement `lib/src/v2/fileset/check.ts` — `checkFileset(pkgPath: string, outputDir: string, selector: SelectorConfig, outputConfig: OutputConfig, marker: ManagedFileMetadata[]): Promise<CheckResult>` — calls `diff()` from `diff.ts` to reuse the read-only diff result (FR-011), then: maps `toModify` → `modified`; maps marker entries absent from all diff categories → `missing`; maps `toAdd` entries not in marker → `extra` drift (FR-011a); applies `applyContentReplacementsToBuffer()` to source content before hash comparison (FR-081); exits non-zero with `"Package X is not installed. Run 'extract' first."` when pkg path absent (FR-043)
- [X] T029 [P] [US2] Implement `lib/src/v2/fileset/check.test.ts` — unit tests: in-sync exits cleanly, modified file reported, missing file reported, extra file reported, unextracted package message, contentReplacements applied before comparison
- [X] T030 [US2] Implement `lib/src/v2/package/action-check.ts` — orchestrate check across filtered filesets (skip unmanaged entries, filter by presets); aggregate drift results; emit ProgressEvents; exit non-zero on any drift (FR-043)
- [X] T031 [P] [US2] Implement `lib/src/v2/package/action-check.test.ts` — integration tests: all in sync → 0, drift → 1, unmanaged entries skipped, preset filtering applied
- [X] T032 [P] [US2] Implement `lib/src/v2/cli/commands/check.ts` — parse argv, merge config, call action-check; print per-file drift lines to stdout; exit 1 on any drift

**Checkpoint**: `check` command fully functional. US1 + US2 both independently testable.

---

## Phase 6: US3 — Recursively Resolve Packages (Priority: P2)

**Goal**: Packages whose `npmdata.sets` reference other packages are recursively resolved. Config inheritance rules (AND-merging, path concatenation, caller-override) applied at every level. Circular dependency detection.

**Independent Test**: 3-level chain (consumer → kit → leaf); extract consumer; verify leaf files at correct concatenated output path.

- [X] T033 Implement `lib/src/v2/package/config-merge.ts` — `mergeSelectorConfig(parent: SelectorConfig, child: SelectorConfig): SelectorConfig` (files AND, contentRegexes AND, presets NOT inherited, upgrade independent) and `mergeOutputConfig(caller: OutputConfig, child: OutputConfig): OutputConfig` (booleans: caller overrides; path: concatenated; symlinks/contentReplacements: appended) (FR-030, FR-031, FR-032)
- [X] T034 [P] [US3] Implement `lib/src/v2/package/config-merge.test.ts` — unit tests for all merge rules: files intersection, contentRegexes intersection, presets not forwarded, force caller-override, path concatenation, symlinks appended, contentReplacements appended
- [X] T035 [US3] Update `lib/src/v2/fileset/diff.ts` — when a package's file enumeration reveals nested `npmdata.sets` entries, call back into `package/action-extract.ts` (bidirectional pattern, FR-002); pass visited package set for circular dependency detection; abort with informative error on cycle detection
- [X] T036 [US3] Update `lib/src/v2/package/action-extract.ts` — accept `visitedPackages: Set<string>` for cycle detection; thread merged configs (via config-merge.ts) into recursive calls; propagate `force`, `dryRun`, `keepExisting` from caller to descendants (FR-030)
- [X] T037 [P] [US3] Update `lib/src/v2/package/action-extract.test.ts` — add 3-level recursive test using installMockPackage chain; test circular dependency abort; test presets NOT forwarded (FR-031); test files AND-merge across levels

**Checkpoint**: Recursive resolution fully functional. US3 independently testable.

---

## Phase 7: US4 — List and Purge Managed Files (Priority: P2)

**Goal**: `list` prints all managed file paths and source packages. `purge` deletes managed files, symlinks into output dir, empty dirs, and cleans up marker and gitignore entries. Both support `--output` and `--verbose`. `purge` supports `--presets` and `--dry-run`.

**Independent Test**: Extract then `list` → expected files reported. `purge` then inspect output dir → all managed files gone, no empty dirs, no marker file.

- [X] T038 [P] [US4] Implement `lib/src/v2/fileset/list.ts` — `listManagedFiles(markerPath: string): Promise<ManagedFileMetadata[]>` — read all `.npmdata` markers found under `outputDir` and return merged list
- [X] T039 [P] [US4] Implement `lib/src/v2/fileset/purge.ts` — `purgeFileset(outputDir: string, entries: ManagedFileMetadata[], dryRun: boolean): Promise<PurgeResult>` — delete managed files, remove all symlinks pointing into outputDir (FR-063, FR-071), remove empty dirs bottom-up, delete or update `.npmdata` marker, remove from `.gitignore`
- [X] T040 [P] [US4] Implement `lib/src/v2/fileset/purge.test.ts` — unit tests: files deleted, symlinks removed, empty dirs cleaned, marker deleted, gitignore entries removed, dryRun reports only
- [X] T041 [P] [US4] Implement `lib/src/v2/package/action-list.ts` — discover all unique output dirs from config entries; aggregate managed files across all `.npmdata` markers in each; note: list always ignores `--presets` (FR-044)
- [X] T042 [P] [US4] Implement `lib/src/v2/package/action-list.test.ts` — integration tests: multiple output dirs, correct aggregate list returned
- [X] T043 [US4] Implement `lib/src/v2/package/action-purge.ts` — iterate filesets filtered by presets; call purgeFileset per entry; aggregate PurgeResult; emit ProgressEvents; dry-run prints list without deleting
- [X] T044 [P] [US4] Implement `lib/src/v2/package/action-purge.test.ts` — integration tests using installMockPackage: full purge, preset filter, dry-run, symlink cleanup
- [X] T045 [P] [US4] Implement `lib/src/v2/cli/commands/list.ts` — parse argv (--output, --verbose), call action-list, print one line per file: `<relPath>  <pkg>@<version>` (cli-contract.md output format); always exits 0
- [X] T046 [P] [US4] Implement `lib/src/v2/cli/commands/purge.ts` — parse argv (--output, --presets, --dry-run, --silent, --verbose), call action-purge; exit 1 on deletion error

**Checkpoint**: `list` and `purge` commands fully functional. US4 independently testable.

---

## Phase 8: Cross-cutting — Symlinks and Content Replacements (US1 + US3 Enhancement)

**Purpose**: Complete the post-extract symlink and content-replacement features referenced in OutputConfig. These are cross-cutting concerns shared by extract (US1) and recursive extract (US3).

- [X] T047 Implement `lib/src/v2/package/symlinks.ts` — `createSymlinks(outputDir: string, symlinkConfigs: SymlinkConfig[]): Promise<void>` (create symlinks for source glob → target dir); `removeStaleSymlinks(outputDir: string, symlinkConfigs: SymlinkConfig[]): Promise<void>` (remove symlinks no longer matching source glob, FR-070, FR-071)
- [X] T048 [P] Implement `lib/src/v2/package/symlinks.test.ts` — unit tests: symlinks created, stale symlinks removed, purge removes all symlinks into output dir
- [X] T049 [P] Implement `lib/src/v2/package/content-replacements.ts` — `applyContentReplacements(files: string[], replacements: ContentReplacementConfig[]): Promise<void>` (apply regex replacements in-place, global flag, back-reference support); `applyContentReplacementsToBuffer(content: string, replacements: ContentReplacementConfig[]): string` (pure function for check comparison, FR-080, FR-081)
- [X] T050 [P] Implement `lib/src/v2/package/content-replacements.test.ts` — unit tests: replacement applied, back-references work, binary files skipped, multiple replacements chained
- [X] T051 Update `lib/src/v2/package/action-extract.ts` — call `createSymlinks` and `applyContentReplacements` in the execute phase after all filesets complete; call `removeStaleSymlinks` at start of each extract run

**Checkpoint**: Symlinks and content replacements fully functional within extract and recursive extract flows.

---

## Phase 9: US5 — Initialise a Publishable Data Package (Priority: P3)

**Goal**: `init` scaffolds `package.json` and `bin/npmdata.js` in a target directory, ready to publish as a self-installable data package.

**Independent Test**: Run `init` in an empty dir; verify `package.json` (name, version, bin, files) and `bin/npmdata.js` shim are created. Install locally and verify `npx <name>` calls runner.

- [X] T052 [US5] Implement `lib/src/v2/package/action-init.ts` — `actionInit(outputDir: string, verbose: boolean): Promise<void>` — create `package.json` (name from dir basename, version `1.0.0`, `bin.npmdata = 'bin/npmdata.js'`, `files: ['bin/', 'data/']`) and `bin/npmdata.js` shim with content: `require('npmdata').run(__dirname, process.argv.slice(2))` — `'npmdata'` is the published package name of the `lib/` package that exports the `run()` function via its `index.ts`; exit 1 if either file already exists (FR-046)
- [X] T053 [P] [US5] Implement `lib/src/v2/cli/commands/init.ts` — parse argv (`--output`, `--verbose`), call action-init; print scaffolded file paths on success

**Checkpoint**: `init` command fully functional. US5 independently testable.

---

## Phase 10: US7 — Post-extract Script Hook (Priority: P3)

**Goal**: `postExtractScript` in config runs after successful extract in `process.cwd()` with full user argv appended. Not invoked during `--dry-run`.

**Independent Test**: Set `postExtractScript: 'node scripts/verify.js'` in `.npmdatarc`, run `extract`, verify the script was invoked with the extract argv appended, in `process.cwd()`.

- [X] T054 [US7] Update `lib/src/v2/package/action-extract.ts` — after successful (non-dry-run) extract, if `config.postExtractScript` is defined, spawn the script in `process.cwd()` with the original user argv appended; propagate non-zero exit code (FR-100 / spec US7 acceptance scenarios)
- [X] T055 [P] [US7] Update `lib/src/v2/package/action-extract.test.ts` — add tests: postExtractScript invoked on success, NOT invoked on dry-run, argv correctly appended

**Checkpoint**: Post-extract hook fully functional. US7 independently testable.

---

## Phase 11: Self-installable Package Runner (US5 Enhancement)

**Purpose**: Implement the `run(binDir, argv)` function used by init-scaffolded packages so `npx <package-name>` works out of the box.

- [X] T056 Implement `lib/src/v2/package/runner.ts` — `run(binDir: string, argv?: string[]): Promise<void>` — reads `package.json` adjacent to `binDir`; reads `npmdata.sets`; falls back to synthetic entry `[{ package: pkg.name, output: { path: '.' } }]` when sets absent (FR-051); dispatches to same action handlers as CLI; supports all commands and flags except `init` (FR-050)
- [X] T057 [P] Implement `lib/src/v2/package/runner.test.ts` — unit tests: runner reads sets from package.json, fallback synthetic entry used when sets absent, dispatches to correct action handler

**Checkpoint**: `run()` fully functional; init-scaffolded packages work with `npx`.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Wire up public exports, CLI bin shim, validate toolchain, verify all quality gates.

- [X] T058 [P] Update `lib/src/v2/index.ts` — finalize all public library exports: `extract`, `check`, `list`, `purge`, `run` pointing to their respective action-*.ts and runner.ts implementations
- [X] T059 [P] Update `lib/src/v2/cli/cli.ts` — wire all 5 command handlers (extract, check, list, purge, init) into the router; verify `--help` and `--version` global handling
- [X] T060 Check if a v2 CLI bin shim is needed — if the `lib/` package should expose a separate `npmdata-v2` binary, add it to `lib/package.json#bin` and create `lib/bin/npmdata-v2.js` shim pointing to `dist/v2/main.js`; otherwise just verify `lib/src/v2/main.ts` is included in the compiled output
- [X] T061 [P] Run `make build` from `lib/` and fix any TypeScript compilation errors across all v2 files (SC-007 prep)
- [X] T062 [P] Verify no file under `lib/src/v2/` exceeds 400 lines — split any violating file into logical sub-files (SC-007)
- [X] T063 [P] Run `make lint-fix` from `lib/` and fix all linting issues across v2 files
- [X] T064 Run `make test` from `lib/` and ensure all v2 tests pass (SC-001 through SC-006); fix any failures
- [X] T065 [P] Validate quickstart.md steps execute correctly: `make build`, `make lint-fix`, `make test` all succeed with no errors
- [X] T065b [P] Validate SC-001 performance: in `lib/src/v2/package/action-extract.test.ts`, add an integration test using `installMockPackage` that creates a 100-file mock package, runs extract, and asserts elapsed time is under 30 s

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)       → no dependencies, start immediately
Phase 2 (Foundational) → depends on Phase 1; BLOCKS all user story phases
Phase 3 (US6 Config)  → depends on Phase 2; BLOCKS Phases 4–11 (all commands need argv + config)
Phase 4 (US1 Extract) → depends on Phase 3; MVP delivery point 🎯
Phase 5 (US2 Check)   → depends on Phase 3; can work in parallel with Phase 4
Phase 6 (US3 Recursive) → depends on Phase 4 (action-extract must exist)
Phase 7 (US4 List/Purge) → depends on Phase 3; can work in parallel with Phases 4–6
Phase 8 (Symlinks/Replacements) → depends on Phase 4 (action-extract must exist)
Phase 9 (US5 Init)    → depends on Phase 3; can work independently
Phase 10 (US7 Hook)   → depends on Phase 4 (action-extract must exist)
Phase 11 (Runner)     → depends on Phase 4 + Phase 9
Phase 12 (Polish)     → depends on all above phases
```

### User Story Dependencies

| Story | Priority | Depends On | Blocks |
|-------|----------|-----------|--------|
| US6 (Config/CLI) | P1 | Phase 2 | Everything |
| US1 (Extract) | P1 | US6 | US3, US7, Runner |
| US2 (Check) | P1 | US6 | — |
| US3 (Recursive) | P2 | US1 | — |
| US4 (List/Purge) | P2 | US6 | — |
| US5 (Init) | P3 | US6 | Runner |
| US7 (PostScript) | P3 | US1 | — |

### Parallel Opportunities (within same phase)

**Phase 2**: T005, T006, T007, T008, T009 can all run in parallel (different files)  
**Phase 3**: T013, T014, T016, T017 can run in parallel after T012  
**Phase 4**: T021, T022 (execute.ts) can run in parallel with T019, T020 (diff.ts); T025 can run after T023  
**Phase 5**: T029, T031, T032 can run in parallel after T028  
**Phase 7**: T038, T039, T040, T041, T042, T045, T046 can all run in parallel  
**Phase 8**: T047, T049, T050 can run in parallel  
**Phase 12**: T058, T059, T061, T062, T063 can run in parallel

---

## Implementation Strategy

### MVP Scope (deliver US6 + US1 first)

Complete Phases 1–4 to have a fully working `extract` command:
1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US6) → Phase 4 (US1)
2. After Phase 4: a developer can extract files from a single npm package end-to-end

### Incremental Delivery

- **Sprint 1 (MVP)**: Phases 1–4 (US6 + US1) — core value proposition
- **Sprint 2**: Phase 5 (US2 Check) + Phase 7 (US4 List/Purge) — operational completeness
- **Sprint 3**: Phase 6 (US3 Recursive) + Phase 8 (Symlinks + Replacements) — power features
- **Sprint 4**: Phases 9–11 (US5 Init, US7 Hook, Runner) + Phase 12 (Polish) — extension points

---

## Summary

| Metric | Count |
|--------|-------|
| Total tasks | 65 |
| Phase 1 (Setup) | 3 |
| Phase 2 (Foundational) | 8 |
| Phase 3 (US6 Config) | 7 |
| Phase 4 (US1 Extract) | 9 |
| Phase 5 (US2 Check) | 5 |
| Phase 6 (US3 Recursive) | 5 |
| Phase 7 (US4 List/Purge) | 9 |
| Phase 8 (Symlinks/Replacements) | 5 |
| Phase 9 (US5 Init) | 2 |
| Phase 10 (US7 Hook) | 2 |
| Phase 11 (Runner) | 2 |
| Phase 12 (Polish) | 8 |
| Tasks marked [P] parallelisable | 38 |
| User stories covered | 7 (US1–US7) |
| Suggested MVP scope | Phases 1–4 (US6 + US1) |
