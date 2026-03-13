# Migration Checklist: npmdata v1 → v2

**Purpose**: Validate that the v2 spec fully covers all v1 capabilities, clearly documents breaking changes, and leaves no ambiguity for a clean-room implementer
**Created**: 2026-03-08
**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Research**: [research.md](../research.md)
**Audience**: Implementer + reviewer during v2 development

---

## Requirement Completeness — v1 Capability Coverage

*Are all v1 behaviours either explicitly preserved or explicitly dropped in the v2 spec?*

- [ ] CHK001 - Are ALL v1 CLI flags documented in v2 FR-042–FR-047, with any intentional removals listed? [Completeness, Spec §FR-042]
- [ ] CHK002 - Is the `cwd` configuration option from v1 (`ConsumerConfig.cwd`) either preserved in v2 config schema or explicitly dropped? [Gap]
- [ ] CHK003 - Is the `packageManager` explicit override field from v1 (`ConsumerConfig.packageManager`) either included in v2 config schema or documented as removed (auto-detect only)? [Gap]
- [ ] CHK004 - Is the `onProgress` callback API (programmatic library use) preserved or explicitly removed in v2? If removed, is the replacement (`ProgressEvent` stream) specified? [Gap, Spec §FR-100]
- [ ] CHK005 - Does the spec cover what v1 exposed as the public library API (`index.ts` exports: `extract`, `check`, `list`, `purge`, `run`)? Are all five exports specified for v2? [Completeness, Spec §FR-050]
- [ ] CHK006 - Is the v1 behaviour of `list` (scans all unique resolved output dirs across entries, not per-package) preserved or re-specified in v2? [Completeness, Spec §FR-044]
- [ ] CHK007 - Is the `purge --packages` scoping (limit deletion to specific packages rather than all entries) specified in v2? [Completeness, Spec §FR-045]

---

## Breaking Change Coverage

*Are all v1→v2 schema and behavioural breaks documented clearly enough that consumers know what to update?*

- [ ] CHK008 - Is the `selector.presets` / `selector.upgrade` schema change (from root-level in v1) documented as a breaking change in a consumer-visible location (README, CHANGELOG, or migration guide)? [Gap, Research §4]
- [ ] CHK009 - Is there a migration guide or upgrade notes document specifying the exact schema rename (`presets` root → `selector.presets`, `upgrade` root → `selector.upgrade`) with before/after examples? [Gap]
- [ ] CHK010 - Is the breaking change to `postExtractScript` working directory (v1: `--output` path; v2: `process.cwd()`) documented as a breaking change for existing consumers using it with a non-default output dir? [Gap, Clarification §Session 2026-03-08 continued]
- [ ] CHK011 - Is the scope of "v2 intentionally breaks backward compat" bounded — i.e., does the spec state whether the `.npmdata` marker file format and `.gitignore` entries written by v2 are still compatible with v1 marker readers? [Consistency, Spec §Assumptions]

---

## Config Schema Clarity

*Is the v2 config schema specified precisely enough to implement without guesswork?*

- [ ] CHK012 - Is the OR vs AND semantics of multiple `contentRegexes` within a **single** SelectorConfig entry (not across merge levels) explicitly stated? The spec only specifies AND for the merge case [FR-030], leaving the intra-entry semantics ambiguous. [Ambiguity, Spec §FR-020]
- [ ] CHK013 - Is the interaction of the `--output` CLI flag with config file entries specified — does it prepend to each entry's `output.path` (concatenate) or replace it? [Ambiguity, Spec §FR-030]
- [ ] CHK014 - Is the `--files` and `--content-regex` CLI flag multi-value format specified — comma-separated in one flag, repeatable flags, or quoted glob list? [Clarity, Spec §FR-042]
- [ ] CHK015 - Is the v2 config file shape (`selector` as a nested object) shown with a complete annotated example in the spec or quickstart, covering all optional fields? [Clarity, Quickstart]

---

## Behavioral Clarity

*Are command behaviours specified precisely enough that two implementers produce the same output?*

- [ ] CHK016 - Is the stdout output format of `check` (per-file diff report, exit-code-only vs structured list) specified with enough precision to produce consistent output? [Clarity, Spec §User Story 2]
- [ ] CHK017 - Is the stdout output format of `list` (e.g., `<relPath>  <packageName>@<version>`) specified in the spec or CLI contract? [Completeness, Contracts §list]
- [ ] CHK018 - Is the stdout summary format of `extract` and `purge` (e.g., "Purge complete: X deleted") specified? v1 uses a specific `"Purge complete: N deleted"` string parsed by `action-purge.ts`. [Completeness, Spec §FR-100]
- [ ] CHK019 - Are symlinks created as **relative** or **absolute** paths? The spec says "source glob matched against files in output dir + target directory relative to output dir" but does not specify the symlink target type. [Ambiguity, Spec §FR-070]
- [ ] CHK020 - Is the error message format for output-path conflicts (two packages writing same path) specified precisely enough to validate against (SC-005)? [Clarity, Spec §Edge Cases]
- [ ] CHK021 - Is the behaviour of `postExtractScript` on non-zero exit (script fails) specified — should it propagate the exit code, log a warning, or abort silently? [Edge Case, Spec §FR-User Story 7]

---

## Scenario Coverage

*Are all required flows covered by acceptance scenarios?*

- [ ] CHK022 - Is the `check --managed=false` skip behaviour covered by an acceptance scenario (it is in FR-043 but absent from User Story 2 scenarios)? [Coverage, Spec §User Story 2]
- [ ] CHK023 - Are acceptance scenarios for `list` and `purge` defined with `--presets` active (the new v2 behaviour where `purge` respects `--presets` and `list` does not)? [Coverage, Spec §User Story 4]
- [ ] CHK024 - Is there an acceptance scenario for the self-installable runner no-config fallback (`npx <package-name>` with no `npmdata.sets`)? [Coverage, Spec §User Story 5, FR-051]
- [ ] CHK025 - Is there an acceptance scenario covering the `check` `extra` drift case (files in package source absent from output and marker)? Scenario 6 exists but does it specify the exact exit code and reported file list? [Clarity, Spec §User Story 2 §6]
- [ ] CHK026 - Is there an acceptance scenario for three-level recursive dependency extraction (SC-002 references it as a success criterion but no scenario covers the merged file-set output precisely)? [Coverage, SC-002]
- [ ] CHK027 - Is there an acceptance scenario covering `--force` + `--managed=false` combination (spec edge case says "managed=false takes precedence") that verifies no error is thrown and existing files are NOT overwritten? [Coverage, Spec §Edge Cases]

---

## Non-Functional Requirements

*Are performance, compatibility, and quality constraints specified and measurable?*

- [ ] CHK028 - Is the maximum file size or file count limit for binary file detection (null-byte scan in first 8 KB) specified? This threshold is assumed from v1 but not stated in spec or assumptions. [Gap, Spec §Assumptions]
- [ ] CHK029 - Is the read-only enforcement behaviour on non-Unix operating systems (e.g., Windows) addressed — or explicitly scoped to Unix/macOS only? [Coverage, Spec §FR-061]
- [ ] CHK030 - Is SC-007 ("no file in v2 exceeds 400 lines") verifiable by automated tooling? Is a linting rule or CI check specified to enforce it, or is it manual-only? [Measurability, SC-007]
- [ ] CHK031 - Is the `--version` output format (just the semver string, or `npmdata v2.0.0` prefix) specified in the CLI contract? [Completeness, Contracts §cli-contract.md]

---

## Dependencies and Assumptions

*Are all inherited v1 assumptions explicitly validated for v2?*

- [ ] CHK032 - Is the assumption "package manager detection follows lock-file presence heuristics" quantified — i.e., does the spec list the exact heuristic (pnpm-lock.yaml → pnpm, yarn.lock → yarn, else npm) so it is reproducible? [Clarity, Spec §Assumptions]
- [ ] CHK033 - Are the `.gitignore` entries written by v2 specified as relative paths (matching v1 behaviour), to ensure consumers' git repos are not broken? [Consistency, Spec §FR-062]
- [ ] CHK034 - Is the assumption that `archiver` (tar.gz) and `pnpm` are available in the test environment documented in `v2/README.md` or `quickstart.md` so CI setup is unambiguous? [Completeness, Quickstart]
- [ ] CHK035 - Is the `.npmdata` CSV marker format (no header row, field order: `path,packageName,packageVersion`) formally specified in `data-model.md` so v1-written markers can still be read by v2? [Consistency, Data Model §10]
