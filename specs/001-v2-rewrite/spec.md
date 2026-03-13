# Feature Specification: npmdata v2 — Clean-room Reimplementation

**Feature Branch**: `001-v2-rewrite`  
**Created**: 2026-03-08  
**Status**: Draft  
**Input**: User description: "perform a major change in the codebase. DON'T REFACTOR EXISTING FILES. instead, create a new folder called v2 and reimplement the whole tool from scratch. Use spec.md as the guide of the spine of the new implementation, and get the details from the existing codebase, but don't bring things that are not clearly related to the new requirements."

## Overview

npmdata is a utility for publishing, extracting, and synchronising files that are distributed via npm packages. Consumers run a single command to pull curated file sets from one or more npm packages into a local output directory. Packages may themselves declare dependencies on other packages, making the resolution recursive.

This feature is a clean-room rewrite of the tool in a new `v2` folder. The existing codebase must not be modified. The new implementation MUST follow the architecture and algorithm described in `lib/spec.md`, only including capabilities that are clearly required by those specifications.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Extract files from a single npm package (Priority: P1)

A developer wants to pull a curated set of files from a published npm package into their local project without manually downloading or copying files.

**Why this priority**: This is the core value proposition of the tool. Every other capability builds on successful file extraction.

**Independent Test**: Run the `extract` command targeting a package and verify the expected files appear in the output directory.

**Acceptance Scenarios**:

1. **Given** a valid npm package name and an output directory, **When** the user runs `extract`, **Then** the matching files are written to the output directory and a `.npmdata` marker file recording the managed files is created alongside them.
2. **Given** files already exist in the output directory from a previous extraction, **When** the user runs `extract` again after the package has been updated, **Then** files that changed are overwritten, files that were removed from the package are deleted from the output directory, and unchanged files are left untouched.
3. **Given** `--dry-run` is passed, **When** the user runs `extract`, **Then** the tool reports what would change but writes nothing to disk.
4. **Given** an existing unmanaged file at the destination path, **When** `extract` is run without `--force`, **Then** the tool reports a conflict and aborts without writing any file.
5. **Given** `--force` is passed, **When** an unmanaged file exists at the destination, **Then** the file is overwritten and the operation succeeds.
6. **Given** `--keep-existing` is passed, **When** a destination file already exists on disk, **Then** that file is skipped (not overwritten) but missing files are still created.
7. **Given** `--managed=false` is passed, **When** the user runs `extract`, **Then** files are written without a `.npmdata` marker, without `.gitignore` updates, and without being made read-only; existing destination files are skipped.

---

### User Story 2 — Check whether local files are in sync with their source packages (Priority: P1)

A developer or CI pipeline wants to verify that locally extracted files have not drifted from the published package source.

**Why this priority**: Without check, teams have no automated way to detect unintentional modifications to managed files.

**Independent Test**: Run `check` after extracting and verify it exits successfully; then modify a managed file and verify `check` exits with a non-zero code and reports the difference.

**Acceptance Scenarios**:

1. **Given** all managed files match their package source, **When** the user runs `check`, **Then** the tool exits 0 and reports everything is in sync.
2. **Given** a managed file has been manually edited, **When** the user runs `check`, **Then** the tool exits non-zero and lists the modified file.
3. **Given** a managed file is missing from the output directory, **When** the user runs `check`, **Then** the tool reports it as missing and exits non-zero.
4. **Given** `contentReplacements` were applied at extraction time, **When** the user runs `check`, **Then** the same replacements are applied to the source content before comparison so that replaced files are not incorrectly reported as modified.
5. **Given** the target package has never been extracted (not installed locally), **When** the user runs `check`, **Then** the tool exits non-zero with a clear message indicating the package is not installed and prompting the user to run `extract` first.
6. **Given** the package source contains files (matching the active selector) that have never been extracted into the output directory and are absent from the `.npmdata` marker, **When** the user runs `check`, **Then** those files are reported as `extra` drift and the tool exits non-zero.

---

### User Story 3 — Recursively resolve packages that depend on other packages (Priority: P2)

A developer publishes a "kit" package that aggregates files from multiple other data packages. A consumer extracts the kit once and automatically receives files from all transitive dependencies.

**Why this priority**: Recursive resolution is the mechanism that enables composable, layered data packages.

**Independent Test**: Create a three-level dependency chain (consumer → kit → leaf), run `extract` on the consumer, and verify files from the leaf package appear in the output directory.

**Acceptance Scenarios**:

1. **Given** a package whose `npmdata` config lists other packages as sets, **When** extraction is triggered, **Then** the tool recursively installs and extracts each dependency package, applying config inheritance rules.
2. **Given** a fileset in a parent package limits `files` to `docs/**`, **When** a dependency package is extracted, **Then** the file filter `docs/**` is intersected (AND-combined) with any filter defined by the dependency itself.
3. **Given** a parent package sets `force: true` in its output config, **When** its dependency packages are extracted, **Then** the `force` flag propagates to all descendant extractions.
4. **Given** a parent package's entry carries a `presets` tag, **When** the dependency package is extracted, **Then** the target package activates ALL of its own internal sets — the `presets` value is NOT forwarded and has no effect on the dependency's internal set selection.
5. **Given** the same output path would be produced from two sibling dependency packages, **When** both are extracted without `--force`, **Then** the tool reports a conflict rather than silently overwriting.

---

### User Story 4 — List and purge managed files (Priority: P2)

A developer wants to inspect which files are currently managed by npmdata, and optionally remove them cleanly.

**Why this priority**: Visibility and cleanup are essential for maintaining trust in the tool's state.

**Independent Test**: Run `list` after extraction and verify the expected files are reported; run `purge` and verify all managed files and empty directories are removed.

**Acceptance Scenarios**:

1. **Given** managed files exist in an output directory, **When** the user runs `list`, **Then** all managed file paths and their source packages are printed.
2. **Given** managed files exist, **When** the user runs `purge`, **Then** all managed files are deleted, empty directories left behind are removed, `.npmdata` marker files and corresponding `.gitignore` entries are cleaned up.
3. **Given** `--dry-run` is passed to `purge`, **When** the user runs `purge`, **Then** the list of files that would be removed is printed but nothing is deleted.

---

### User Story 5 — Initialise a publishable data package (Priority: P3)

A developer wants to scaffold a new npm package that bundles files and exposes its own CLI so consumers can run `npx <package-name>` to extract those files.

**Why this priority**: `init` accelerates setup of new data packages but is not required for consumers to extract from existing ones.

**Independent Test**: Run `init` in an empty directory, install the resulting package locally, and verify `npx <package-name>` successfully extracts the bundled files into a consumer's directory.

**Acceptance Scenarios**:

1. **Given** an empty directory, **When** the user runs `npmdata init`, **Then** a valid `package.json` and a minimal `bin/npmdata.js` entry-point are created, ready to be published.
2. **Given** the scaffolded package is installed by a consumer, **When** the consumer runs `npx <package-name>`, **Then** the package's own files are extracted into the consumer's working directory using the runner logic.

---

### User Story 6 — Configure extraction via config file or CLI flags (Priority: P1)

A developer wants to define extraction settings once in a config file rather than passing them as CLI flags every time.

**Why this priority**: Without config file support, every extraction requires repetitive flag typing; this would make the tool impractical for real projects.

**Independent Test**: Create a `.npmdatarc` file with package and output settings, run `extract` with no additional flags, and verify extraction succeeds using the config file values.

**Acceptance Scenarios**:

1. **Given** a `.npmdatarc` file in the working directory specifying packages and output paths, **When** the user runs `extract` without additional flags, **Then** the tool reads and honours the config file settings.
2. **Given** a `package.json` with an `npmdata` key, **When** `.npmdatarc` is absent, **Then** the tool reads config from `package.json` instead.
3. **Given** both a config file and CLI flags are present, **When** the user runs any command, **Then** CLI flags take precedence over config file values.
4. **Given** `--packages` is passed on the CLI, **When** a config file also has `sets`, **Then** the `--packages` flag overrides the config file sets.

---

### User Story 7 — Post-extract script hook (Priority: P3)

A developer wants to run a custom script automatically after every successful extraction to process the extracted files.

**Why this priority**: The post-extract hook is a power-user extension point; it does not affect core extraction correctness.

**Independent Test**: Define `postExtractScript` in the npmdata config, run `extract`, and verify the script is invoked with the same CLI arguments that were passed to `extract`.

**Acceptance Scenarios**:

1. **Given** a `postExtractScript` is defined in the config, **When** the user runs a successful `extract`, **Then** the script is executed with the extract arguments appended, in the CLI invocation directory (`process.cwd()`).
2. **Given** `--dry-run` is passed, **When** `extract` completes, **Then** the `postExtractScript` is NOT executed.

---

### Edge Cases

- What happens when a package name is valid but the package does not exist in the registry? → Tool reports a clear error and exits non-zero.
- What happens when a circular dependency exists between packages? → Tool detects the cycle and exits with an informative error.
- What happens when the output directory does not exist? → Tool creates it (and any parent directories) before writing files.
- What happens when `--force` and `--keep-existing` are both passed? → Tool exits with a validation error before performing any work.
- What happens when `--force` and `--managed=false` are both passed? → `--managed=false` takes precedence; existing files are not overwritten.
- What happens when a package has no npmdata config and is extracted as a leaf? → The tool extracts all files in the package matching the inherited selector config (defaulting to all files minus package metadata).
- What happens when the same output path would be written by two different leaf packages without `--force`? → Tool reports a conflict listing both packages and aborts.
- What happens when a `.npmdata` marker file is manually deleted? → On next `extract` the tool treats previously managed files as unmanaged and applies normal conflict rules.
- What happens when binary files are present in a package? → They are copied as-is; content-regex filters are skipped for binary files.
- What happens when `check` is run but the package has never been extracted? → Tool exits non-zero with a message: "Package X is not installed. Run 'extract' first."
- What happens when `extract` fails partway through (e.g. a conflict or write error)? → Files that were newly created during the failed run are deleted (partial rollback). Files that were overwritten (replacing a pre-existing managed file) are left in their new state. The error is reported with the file that caused the failure.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Architecture

- **FR-001**: The implementation MUST reside in a new `lib/src/v2/` folder within the existing `lib/` project and MUST NOT modify any existing file in `lib/src/` (v1 code) or outside `lib/`.
- **FR-002**: The `v2` folder MUST be internally organised into three sub-layers:
  - `/cli` — UI layer: argument parsing, config loading, console output, error display. No business logic.
  - `/package` — Orchestration layer: config resolution, fileset iteration, two-phase action coordination, symlink management, content-replacement application, post-extract script execution. Each action (`extract`, `check`, `list`, `purge`) MUST have its own file.
  - `/fileset` — File layer: per-fileset diff computation and file-level read/write operations. When a fileset entry references another package as a dependency, `/fileset` MUST call back into `/package` to trigger recursive resolution (bidirectional call pattern matching `lib/spec.md`).
- **FR-003**: Business logic MUST NOT be placed in the `/cli` layer; `/cli` only prepares inputs and displays outputs.
- **FR-004**: All calls between `/package` and `/fileset` MUST be direct in-process function calls. Subprocess spawning per entry (as used in v1) MUST NOT be used. This enables the two-phase diff/execute model, eliminates stdout-parsing fragility, and makes the layers independently unit-testable.

#### Two-Phase Extraction Algorithm

- **FR-010**: File operations MUST be divided into two phases:
  1. **Diff phase** — Read-only computation of which files need to be added, modified, deleted, or skipped. This phase produces an extraction map and MUST NOT write to disk.
  2. **Execute phase** — Performs disk writes, deletions, marker updates, `.gitignore` updates, symlink creation, and content replacements based on the extraction map from the diff phase.
- **FR-011**: The diff phase result MUST be reusable across all actions (`extract`, `check`, `purge`, `list`) so that file-read logic is not duplicated per action.
- **FR-011a**: `check` MUST compare the full filtered package source contents (applying the active `SelectorConfig`) against the output directory — not only files listed in the `.npmdata` marker. Files present in the filtered package source but absent from both the marker and the output directory MUST be reported as `extra` drift, causing the command to exit non-zero.
- **FR-012**: File deletions (managed files removed from the package source) MUST be collected during the diff phase across ALL filesets and executed ONLY after all filesets have been processed, to prevent removing a file that another fileset in the same operation would re-add.
- **FR-013**: On extraction failure, the tool MUST perform a partial rollback: any files that were newly created (did not exist before the current run) across **all filesets processed in the current invocation** MUST be deleted. Files that were overwritten (replacing a pre-existing managed file) MUST be left in their post-write state. The error message MUST identify the file that caused the failure.

#### Config Groups

- **FR-020**: Each extraction entry MUST carry four distinct config groups:
  - **PackageConfig**: `name`, `version`. Identifies which package to install. In config files (`.npmdatarc` / `package.json`), the package is expressed as a flat string `"my-pkg@^1.2.3"` (same as v1); `PackageConfig` is the internal representation produced by parsing that string. `upgrade` is NOT part of `PackageConfig`; it is expressed in config files under `SelectorConfig`.
  - **SelectorConfig**: `files` (glob patterns), `contentRegexes` (array of regex strings), `presets`, `upgrade`. Controls which files are selected from a package and whether a fresh install is forced. `presets` tags this entry so the caller's `--presets` CLI flag can include or exclude it; the presets value is NOT forwarded to the target package's internal set selection. `upgrade` forces a fresh package install even when a satisfying version is already present.
  - **OutputConfig**: `path`, `force`, `keepExisting`, `gitignore`, `unmanaged`, `dryRun`, `symlinks`, `contentReplacements`. Controls where and how files are written.
  - **ExecutionConfig**: `silent`, `verbose`. Controls runtime output behaviour. In config files these fields are expressed as top-level fields on each entry (same as v1); `ExecutionConfig` is an internal grouping type only and is never a nested key in config files.

#### Config Merging (Recursive Resolution)

- **FR-030**: When a package references another package as a dependency (via `npmdata.sets`), selector and output configs MUST be inherited according to these rules:
  - `files` patterns: combined with AND logic (a file must match BOTH the parent's patterns AND the child's own patterns).
  - `contentRegexes`: combined with AND logic across the chain.
  - `OutputConfig` overridable fields (`force`, `keepExisting`, `gitignore`, `unmanaged`, `dryRun`): caller (higher in hierarchy, closer to the user) overrides the package's own value.
  - `output.path`: paths are CONCATENATED across levels, e.g., `<CLI path>/<package1 path>/<package2 path>`.
  - `symlinks` and `contentReplacements`: entries are APPENDED (not replaced) across the chain.
- **FR-031**: `presets` MUST NOT be inherited and MUST NOT be forwarded to target packages. `presets` is consumed exclusively at the level where it is defined: it tags the local entry so the runner's `--presets` flag can filter which entries to process. The target package always activates all of its own internal sets regardless of the caller's `presets` value.
- **FR-032**: When `--presets` is **not** passed, ALL entries are processed regardless of whether they have a `presets` field. The preset filter is opt-in; absence of the flag means no filtering occurs.

#### Config File Discovery

- **FR-025**: The tool MUST use cosmiconfig to discover config, supporting the following sources in priority order: `.npmdatarc`, `.npmdatarc.json`, `.npmdatarc.yaml`, `.npmdatarc.js`, `npmdata.config.js`, and the `npmdata` key in `package.json`. This matches v1 discovery behaviour.
- **FR-026**: CLI flags take precedence over all config file values. When `--packages` is passed, config file `sets` are ignored.

#### CLI Commands

- **FR-040**: The tool MUST support the following CLI commands: `extract`, `check`, `list`, `purge`, `init`.
- **FR-041**: When no command is given or the first argument is a flag, the tool MUST default to `extract`.
- **FR-042**: `extract` MUST accept: `--packages`, `--output`, `--files`, `--content-regex`, `--force`, `--keep-existing`, `--gitignore`, `--managed`, `--dry-run`, `--upgrade`, `--silent`, `--verbose`, `--presets`. All boolean flags accept `--flag`, `--flag=true`, or `--flag=false` forms.
- **FR-043**: `check` MUST accept: `--packages`, `--output`, `--files`, `--content-regex`, `--managed`, `--presets`, `--verbose`. When `--managed=false` is passed (or `entry.output.unmanaged` is true), those entries are silently excluded from the check scope — checking unmanaged files is a no-op. When `--presets` is passed, only entries whose preset tags overlap with the requested presets are checked.
- **FR-044**: `list` MUST accept: `--output`, `--verbose`. `list` MUST ignore `--presets` and always report all entries regardless of preset tags — it is informational and read-only.
- **FR-045**: `purge` MUST accept: `--packages`, `--output`, `--presets`, `--dry-run`, `--silent`, `--verbose`. When `--presets` is passed, only entries whose preset tags overlap with the requested presets are purged.
- **FR-046**: `init` MUST scaffold a publishable package with `package.json` and a minimal `bin` entry-point that uses the runner.
- **FR-047**: `--help` MUST print usage information; `--version` MUST print the tool version.

#### Self-Installable Package Runner

- **FR-050**: The tool MUST expose a `run(binDir, argv)` function that a generated bin entry-point can call so that a published data package can serve as its own installer (`npx <package-name>`).
- **FR-051**: The runner MUST read `npmdata.sets` from the hosting package's `package.json` and process entries the same way as the CLI, including preset filtering. When `npmdata.sets` is absent or empty, the runner MUST fall back to a single synthetic entry: `{ package: <pkg.name>, output: { path: '.' } }` with no file filtering. This fallback enables `npx <package-name>` to work out of the box with no config.

#### File Management

- **FR-060**: After a successful extraction, the tool MUST write a `.npmdata` marker file in the output directory listing every managed file path, its source package name, and source package version.
- **FR-061**: The tool MUST default to making managed files read-only so accidental edits are surfaced immediately (not applicable in `--managed=false` mode).
- **FR-062**: Unless disabled, the tool MUST create or update a `.gitignore` file alongside each `.npmdata` marker, adding all managed file paths to it.
- **FR-063**: On `purge`, the tool MUST: (1) delete all managed files for the targeted entries; (2) remove all symlinks that point into the purged output directory; (3) remove any empty directories remaining after deletion.

#### Symlinks

- **FR-070**: After extraction, the tool MUST create symlinks as defined in `symlinks` entries. Each entry specifies a `source` glob (matched against files in the output directory) and a `target` directory (relative to the output directory) where symlinks are created.
- **FR-071**: Stale symlinks pointing into the output directory that no longer match the source glob MUST be removed automatically during `extract`. During `purge`, ALL symlinks pointing into the purged output directory MUST be removed regardless of whether they still match the source glob.

#### Content Replacements

- **FR-080**: After extraction, the tool MUST apply content replacements as defined in `contentReplacements` entries. Each entry specifies a `files` glob (relative to the working directory), a `match` regex, and a `replace` string (may contain back-references).
- **FR-081**: When `check` is run, the same `contentReplacements` MUST be applied to the package source content before comparing hashes so that replaced files are not incorrectly reported as modified.

#### File Filtering Defaults

- **FR-090**: When no `files` selector is specified, the tool MUST apply a default exclusion list: include everything except `package.json`, `bin/**`, `README.md`, and `node_modules/**`.

#### Progress Reporting

- **FR-100**: The tool MUST emit structured progress events for each file processed: `file-added`, `file-modified`, `file-deleted`, `file-skipped`, `package-start`, `package-end`.
- **FR-101**: When `--silent`, only the final summary line is printed (no per-file output).
- **FR-102**: When `--verbose`, detailed step information including resolved paths and intermediate decisions is printed.

### Key Entities

- **Package**: An npm package containing data files. May include an `npmdata` config describing sets, selectors, and output options.
- **Fileset**: One entry in the `npmdata.sets` array — combines a package reference with SelectorConfig and OutputConfig.
- **Extraction Map (Diff)**: The read-only output of the diff phase — a structure listing files to be added, modified, deleted, or skipped with source and destination paths.
- **Managed File**: A file tracked by a `.npmdata` marker; owned by a specific package at a specific version.
- **Marker File (`.npmdata`)**: A file in the output directory recording which files are managed, by which package, and at which version.
- **PackageConfig**: `{ name: string, version?: string }` — internal parsed representation of a package spec. In config files the package is expressed as a flat string (`"my-pkg@^1.2.3"`). `PackageConfig` is never exposed directly in config files.
- **SelectorConfig**: `{ files?: string[], contentRegexes?: string[], presets?: string[], upgrade?: boolean }` — controls which package files are selected for extraction and install behaviour. `presets` tags the local entry so the caller's `--presets` flag can include or exclude it; it is NOT forwarded to the target package. `upgrade` forces a fresh package install even when a satisfying version is already installed.
- **OutputConfig**: `{ path: string, force?, keepExisting?, gitignore?, unmanaged?, dryRun?, symlinks?, contentReplacements? }` — controls where and how files are written.
- **ExecutionConfig**: `{ silent?, verbose? }` — controls runtime output behaviour. In config files, `silent` and `verbose` are top-level fields on each entry (not nested under an `execution` key); `ExecutionConfig` is an internal grouping type only.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A consumer can extract files from a single package by running one command with no prior setup other than having the tool installed, completing in under 30 seconds for packages up to 100 files.
- **SC-002**: A consumer can extract from a three-level recursive package hierarchy and receive the correct merged set of files with no manual intervention.
- **SC-003**: Running `check` in a CI pipeline deterministically exits 0 when all managed files match their source and exits non-zero when any file has drifted, with each difference clearly identified in the output.
- **SC-004**: `purge` removes all managed files and leaves no empty directories or orphaned marker files behind, verifiable by inspecting the output directory after the command.
- **SC-005**: All acceptance scenarios defined in the User Scenarios section can be demonstrated to pass through manual or automated testing without modifying any file outside the `v2` folder.
- **SC-006**: The v2 implementation contains unit tests that cover the diff phase independently of the execute phase, verifiable by running the test suite.
- **SC-007**: No file in the v2 implementation exceeds 400 lines, verifiable by automated line-count check.

---

## Clarifications

### Session 2026-03-08

- Q: What should `SelectorConfig.presets` mean in v2 — dual role (local tag + forwarded to target package), local filter only, or target filter only? → A: Local filter only. `presets` tags the local entry so `--presets` CLI flag can include/exclude it. The target package always activates all its own internal sets; the value is never forwarded.
- Q: Where should `presets` live in the v2 config file schema — top-level entry field (like v1) or nested inside `SelectorConfig`? → A: Nested inside `SelectorConfig`, as the v2 spec currently states.
- Q: Which recursion model should v2 follow — `/fileset` calls back into `/package` for sub-packages (bidirectional), or `/package` owns all recursion and `/fileset` is leaf-only? → A: Bidirectional. `/fileset` calls back into `/package` when it encounters a dependency package, matching the `lib/spec.md` pseudo-algorithm.
- Q: Where should `upgrade` be declared in v2 config files? → A: Inside `SelectorConfig` (alongside `files`, `contentRegexes`, `presets`). `PackageConfig` remains internal-only; `upgrade` is surfaced in config files as part of the selector group.
- Q: Should `check` report files that are in the package source but absent from the output directory and never tracked in the `.npmdata` marker? → A: Yes — report them as `extra` drift. `check` validates completeness against full filtered package contents, not just the marker.
- Q: Where should `silent` and `verbose` live in v2 config files? → A: Top-level on each entry (same as v1). `ExecutionConfig` is an internal grouping type only and is never expressed as a nested key in config files.
- Q: What should `check` do when the target package has never been extracted (not installed locally)? → A: Exit non-zero with a clear message stating the package is not installed and prompting the user to run `extract` first.
- Q: What is the failure/atomicity behaviour when `extract` fails mid-run? → A: Partial rollback — newly created files are deleted; overwritten files are left in their new state. Error reports the causing file.
- Q: What format should config files use for `PackageConfig` — flat string, structured object, or both? → A: Flat string (`"my-pkg@^1.2.3"`) in config files, same as v1. `PackageConfig` is an internal parsed type only, never exposed in config.
- Q: Should `/package` call `/fileset` in-process or spawn a CLI subprocess per entry? → A: Direct in-process function calls. No subprocess spawning per entry. This is required to make the two-phase diff/execute model meaningful and the layers independently testable.
- Q: Should v2 support the v1 config file schema (where `presets` and `upgrade` are root-level fields on each entry) for backward compatibility? → A: No. v2 uses the new nested schema only (`selector.presets`, `selector.upgrade`). v2 intentionally breaks backward compatibility with v1 config files; migration is the consumer's responsibility and may be documented in README.
- Q: When `--presets` is not passed on the CLI, should entries that have a `presets` field defined still be processed? → A: Yes. All entries are processed when no preset filter is active. `--presets` is an opt-in filter; omitting it means no filtering occurs.
- Q: In which working directory should `postExtractScript` run when there are multiple filesets with different `output.path` values? → A: Always in the CLI invocation directory (`process.cwd()`), never in a fileset output path. This guarantees a stable, predictable cwd regardless of fileset count.
- Q: When `extract` fails mid-run across multiple filesets, does the partial rollback cover only the failing fileset or ALL filesets processed in the current invocation? → A: All filesets. Any file newly created during the current invocation (across all filesets) is deleted on failure. This ensures no partial state is left from any fileset.
- Q: Which config file names should v2 discover — full cosmiconfig breadth (same as v1) or only `.npmdatarc` and `package.json`? → A: Full cosmiconfig breadth, same as v1: `.npmdatarc`, `.npmdatarc.json`, `.npmdatarc.yaml`, `.npmdatarc.js`, `npmdata.config.js`, and the `npmdata` key in `package.json`.

### Session 2026-03-08 (continued)

- Q: Should `check` skip entries whose output is `unmanaged` (either via `entry.output.unmanaged` or `--managed=false` flag)? → A: Yes. Checking an unmanaged file is meaningless (no marker, no tracking). `check` silently excludes unmanaged entries. `--managed=false` is a valid `check` flag with this effect.
- Q: Should `list` and `purge` respect `--presets` filtering? → A: `list` ignores `--presets` (always lists all entries; it is informational and read-only). `purge` respects `--presets` (only purges entries matched by the active preset filter, matching v1 behaviour).
- Q: What should the self-installable runner do when the hosting package has no `npmdata.sets` in its `package.json`? → A: Fall back to a single synthetic entry that extracts the package itself (`pkg.name`) into `output.path: '.'` with no file filtering. This is what makes `npx <package-name>` work out of the box with no config.
- Q: Should `check` accept `--presets` to narrow its scope to preset-matching entries? → A: Yes. `check` accepts `--presets` and filters entries the same way as `extract` and `purge`. All stateful commands support preset scoping for consistency.
- Q: What should `purge` do with symlinks pointing into the purged output directory? → A: `purge` MUST remove all managed files AND any symlinks pointing into the purged output directory, then clean up empty directories. Leaving dangling symlinks after a purge would be inconsistent.

---

## Assumptions

- `lib/spec.md` is the authoritative source for architecture and algorithm decisions; where it differs from the current implementation, `lib/spec.md` takes precedence.
- **v2 makes no effort to maintain backward compatibility with v1.** Config file schema, internal APIs, and CLI flag semantics may all change. The v2 config file schema places `presets` and `upgrade` inside the `selector` sub-object; the v1 flat schema is not supported.
- Package manager detection (pnpm / yarn / npm) follows lock-file presence heuristics, same as the current implementation.
- Binary file detection and copy behaviour follows the same rules as the current implementation.
- The `.npmdata` marker file format (CSV rows of path, package name, package version) is preserved for compatibility with consumers who may have existing marker files.
- `gitignore` management is enabled by default unless `--gitignore=false` is passed or the config value is explicitly `false`.
- Content-regex filtering skips binary files.
