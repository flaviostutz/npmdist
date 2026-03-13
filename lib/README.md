# npmdata

Publish folders as npm packages and extract them in any workspace. Use it to distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry.

## How it works

- **Publisher**: a project that has folders to share. Running `init` prepares its `package.json` so those folders are included when the package is published.
- **Consumer**: any project that installs that package and runs `extract` to download the files locally. A `.npmdata` marker file is written alongside the managed files to track ownership and enable safe updates.

## Extraction patterns

There are two ways to extract data with `npmdata`. Choose the one that fits your situation:

### Pattern 1 — Ad-hoc CLI extraction

Use `npx npmdata extract` directly from the command line whenever you need to pull files from a package without any prior setup.

```sh
npx npmdata extract --packages my-shared-assets@^2.0.0 --output ./data
```

### Pattern 2 — Data packages with embedded configuration

Create a dedicated npm package whose `package.json` declares an `npmdata` config block. That config encodes the extraction sources, output directories, filtering rules, and any combination of upstream packages. Consumers install the data package and run its bundled script — they don't need to know the internals.

**Publisher** — add an `npmdata` block to the data package's `package.json`:

```json
{
  "name": "my-org-configs",
  "version": "1.0.0",
  "npmdata": {
    "sets": [
      {
        "package": "base-datasets@^3.0.0",
        "selector": { "files": ["datasets/**"] },
        "output": { "path": "./data/base" }
      },
      {
        "package": "org-configs@^1.2.0",
        "selector": { "contentRegexes": ["env: production"] },
        "output": { "path": "./configs" }
      }
    ]
  }
}
```

Run `pnpm dlx npmdata init` in that package and then `npm publish` to release it.

**Consumer** — just install and run:

```sh
npx my-org-configs extract --output ./local-data
```

No knowledge of the upstream packages or transformation rules is required.

**When to use:** When an intermediary team (a platform, infrastructure, or data team) wants to bundle, curate, and version a collection of data from multiple sources and hand it to consumers as a single, opinionated package. Consumers get a stable, self-describing interface; producers control all the complexity.

### Pattern 3 — Config file mode

Add an `npmdata` configuration directly to a project's own `package.json` (or a `.npmdatarc` file) and then run `npmdata extract` without `--packages`. The CLI automatically loads the configuration and runs every entry, reusing the same runner logic as data packages.

**Consumer** — declare the config inline in `package.json`:

```json
{
  "name": "my-project",
  "npmdata": {
    "sets": [
      {
        "package": "base-datasets@^3.0.0",
        "selector": { "files": ["datasets/**"] },
        "output": { "path": "./data" }
      }
    ]
  }
}
```

Or write a standalone `.npmdatarc` (JSON object at the top level):

```json
{
  "sets": [
    {
      "package": "base-datasets@^3.0.0",
      "selector": { "files": ["datasets/**"] },
      "output": { "path": "./data" }
    }
  ]
}
```

Then run any command without `--packages`:

```sh
npx npmdata           # same as 'npx npmdata extract'
npx npmdata extract   # reads config, extracts all entries
npx npmdata check     # checks all entries
npx npmdata purge     # purges all entries
```

Config is resolved using [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). Sources searched in order from the current directory:

| Source | Key / format |
|---|---|
| `package.json` | `"npmdata"` key — object with `"sets"` array |
| `.npmdatarc` | JSON or YAML object with `"sets"` array |
| `.npmdatarc.json` | JSON object with `"sets"` array |
| `.npmdatarc.yaml` / `.npmdatarc.yml` | YAML object with `"sets"` array |
| `npmdata.config.js` | CommonJS module exporting object with `sets` array |

All runner flags (`--dry-run`, `--silent`, `--verbose`, `--gitignore=false`, `--managed=false`, `--presets`, `--output`) work as usual.

**When to use:** When a consuming project wants to pin and automate a set of data extractions locally without publishing a separate data package. This is the lightest-weight approach — no extra package, no `init` step, just a config block and a single CLI call.

---

## Quick start

### 1. Prepare the publisher package

In the project whose folders you want to share:

```sh
# share specific folders by glob pattern (required)
pnpm dlx npmdata init --files "docs/**,data/**,configs/**"

# also bundle an additional package so consumers get data from both sources
pnpm dlx npmdata init --files "docs/**" --packages shared-configs@^1.0.0

# share multiple additional packages at once
pnpm dlx npmdata init --files "docs/**" --packages "shared-configs@^1.0.0,base-templates@2.x"

```

`init` updates `package.json` with the right `files`, `bin`, and `dependencies` fields so those folders are included when the package is published, and writes a thin `bin/npmdata.js` entry point. Then publish normally:

```sh
npm publish
```

### 2. Extract files in a consumer project

```sh
# extract all files from the package
npx npmdata extract --packages my-shared-assets --output ./data

# extract from a specific version
npx npmdata extract --packages my-shared-assets@^2.0.0 --output ./data

# extract from multiple packages at once
npx npmdata extract --packages "my-shared-assets@^2.0.0,another-pkg@1.x" --output ./data

# extract only markdown files
npx npmdata extract --packages my-shared-assets --files "**/*.md" --output ./docs

# extract only files whose content matches a regex
npx npmdata extract --packages my-shared-assets --content-regex "env: production" --output ./configs

# overwrite files that are unmanaged or owned by a different package;
# the new package takes ownership in the marker file
npx npmdata extract --packages my-shared-assets --output ./data --force

# skip .gitignore entries for managed files (gitignore is enabled by default)
npx npmdata extract --packages my-shared-assets --output ./data --gitignore=false

# write files without a .npmdata marker or .gitignore entry; files won't be read-only
# and won't be tracked by npmdata; existing files are left unchanged
npx npmdata extract --packages my-shared-assets --output ./data --managed=false

# preview what would change without writing any files
npx npmdata extract --packages my-shared-assets --output ./data --dry-run

# force-reinstall the package even if already installed (e.g. after a floating tag moves)
npx npmdata extract --packages my-shared-assets@latest --output ./data --upgrade
```

`extract` logs every file change as it happens:

```
A	data/users-dataset/user1.json
M	data/configs/app.config.json
D	data/old-file.json
```

If the published package includes its own bin script (normally when it's prepared using "init") you can also call it directly so it extracts data that is inside the package itself:

```sh
npx my-shared-assets extract --output ./data
npx my-shared-assets check  --output ./data
```

When the data package defines multiple `npmdata` entries in its `package.json`, you can limit which entries are processed using the `--presets` option. Only entries whose `presets` list includes at least one of the requested presets will be extracted; entries with no presets are skipped when a preset filter is active.

```sh
# run only entries tagged with "prod"
npx my-shared-assets --presets prod

# run entries tagged with either "prod" or "staging"
npx my-shared-assets --presets prod,staging
```

To use presets, add a `presets` array to each `npmdata` entry in the data package's `package.json`:

```json
{
  "npmdata": {
    "sets": [
      { "package": "my-shared-assets", "output": { "path": "./data" }, "presets": ["prod"] },
      { "package": "my-dev-assets",    "output": { "path": "./dev-data" }, "presets": ["dev", "staging"] }
    ]
  }
}
```

Check the /examples folder to see this in action

### Data package CLI options

When calling the bin script bundled in a data package, the following options are accepted. Options that overlap with per-entry settings override every entry globally, regardless of what is set in `package.json`.

| Option | Description |
|---|---|
| `--output, -o <dir>` | Base directory for resolving all `output.path` values (default: cwd). |
| `--presets <preset1,preset2>` | Limit to entries whose `presets` overlap with the given list (comma-separated). |
| `--gitignore [bool]` | Disable `.gitignore` management for every entry when set to `false`, overriding each entry's `gitignore` field. |
| `--managed [bool]` | Run every entry in unmanaged mode when set to `false`, overriding each entry's `unmanaged` field. Files are written without a `.npmdata` marker, without `.gitignore` updates, and without being made read-only. |
| `--dry-run` | Simulate changes without writing or deleting any files. |
| `--verbose, -v` | Print detailed progress information for each step. |

```sh
# disable gitignore management across all entries
npx my-shared-assets --gitignore=false

# write all files as unmanaged (editable, not tracked)
npx my-shared-assets --managed=false

# combine overrides
npx my-shared-assets --gitignore=false --managed=false --dry-run
```

### npmdata entry options reference

Each entry in the `npmdata.sets` array in `package.json` supports the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `package` | `string` | required | Package spec to install and extract. Either a bare name (`my-pkg`) or with a semver constraint (`my-pkg@^1.2.3`). |
| `output.path` | `string` | `.` (cwd) | Directory where files will be extracted, relative to where the consumer runs the command. |
| `selector.files` | `string[]` | all files | Glob patterns to filter which files are extracted (e.g. `["data/**", "*.json"]`). |
| `selector.exclude` | `string[]` | `["package.json","bin/**","README.md","node_modules/**"]` (when `files` is unset), none otherwise | Glob patterns to exclude files even when they match `selector.files` (e.g. `["test/**", "**/*.test.*"]`). |
| `selector.contentRegexes` | `string[]` | none | Regex patterns (as strings) to filter files by content. Only files matching at least one pattern are extracted. |
| `output.force` | `boolean` | `false` | Allow overwriting existing unmanaged files or files owned by a different package. |
| `output.keepExisting` | `boolean` | `false` | Skip files that already exist but create them when absent. Cannot be combined with `force`. |
| `output.gitignore` | `boolean` | `true` | Create/update a `.gitignore` file alongside each `.npmdata` marker file. Set to `false` to disable. |
| `output.unmanaged` | `boolean` | `false` | Write files without a `.npmdata` marker, `.gitignore` update, or read-only flag. Existing files are skipped. |
| `output.dryRun` | `boolean` | `false` | Simulate extraction without writing anything to disk. |
| `selector.upgrade` | `boolean` | `false` | Force a fresh install of the package even when a satisfying version is already installed. |
| `silent` | `boolean` | `false` | Suppress per-file output, printing only the final result line. |
| `presets` | `string[]` | none | Presets used to group and selectively run entries with `--presets`. |
| `output.symlinks` | `SymlinkConfig[]` | none | Post-extract symlink operations (see below). |
| `output.contentReplacements` | `ContentReplacementConfig[]` | none | Post-extract content-replacement operations (see below). |

#### SymlinkConfig

After extraction, for each config the runner resolves all files/directories inside `output.path` that match `source` and creates a corresponding symlink inside `target`. Stale symlinks pointing into `output.path` but no longer matched are removed automatically.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Glob pattern relative to `output.path`. Every matching file or directory gets a symlink in `target`. Example: `"**\/skills\/**"` |
| `target` | `string` | Directory where symlinks are created, relative to the project root. Example: `".github/skills"` |

#### ContentReplacementConfig

After extraction, for each config the runner finds workspace files matching `files` and applies the regex replacement to their contents.

| Field | Type | Description |
|---|---|---|
| `files` | `string` | Glob pattern (relative to the project root) selecting workspace files to modify. Example: `"docs/**\/*.md"` |
| `match` | `string` | Regex string locating the text to replace. Applied globally to all non-overlapping occurrences. Example: `"<!-- version: .* -->"` |
| `replace` | `string` | Replacement string. May contain regex back-references such as `$1`. Example: `"<!-- version: 1.2.3 -->"` |

Example with multiple options:

```json
{
  "npmdata": [
    {
      "package": "my-shared-assets@^2.0.0",
      "selector": {
        "files": ["docs/**", "configs/*.json"],
        "upgrade": true
      },
      "output": {
        "path": "./data",
        "gitignore": true,
        "symlinks": [
          { "source": "**\/skills\/**", "target": ".github/skills" }
        ],
        "contentReplacements": [
          { "files": "docs/**\/*.md", "match": "<!-- version: .* -->", "replace": "<!-- version: 2.0.0 -->" }
        ]
      },
      "presets": ["prod"]
    }
  ]
}
```

### 3. Check files are in sync

Verifies that every file in the output directory matches what is currently in the published package. When the target package itself declares `npmdata.sets`, check recurses into those transitive dependencies — reporting drift at every level of the hierarchy without downloading anything new beyond what is already installed. Use `selector.presets` on an entry to restrict which of the target's sets are checked.

```sh
npx npmdata check --packages my-shared-assets --output ./data
# exit 0 = in sync, exit 1 = drift or error

# check multiple packages
npx npmdata check --packages "my-shared-assets,another-pkg" --output ./data
```

The check command reports differences per package:

```
  my-shared-assets@2.1.0: out of sync
    - missing:  data/new-file.json
    ~ modified: data/configs/app.config.json
    + extra:    data/old-file.json
```

### 4. List managed files

```sh
# list all files managed by npmdata in an output directory
npx npmdata list --output ./data
```

Output is grouped by package:

```
my-shared-assets@2.1.0
  data/users-dataset/user1.json
  data/configs/app.config.json

another-pkg@1.0.0
  data/other-file.txt
```

### 5. Purge managed files

Remove all files previously extracted by one or more packages without touching any other files in the output directory. No network access or package installation is required — only the local `.npmdata` marker state is used. When the target package itself declares `npmdata.sets`, purge recurses into those transitive dependencies and removes their managed files too, mirroring what extract originally created.

```sh
# remove all files managed by a package
npx npmdata purge --packages my-shared-assets --output ./data

# purge multiple packages at once
npx npmdata purge --packages "my-shared-assets,another-pkg" --output ./data

# preview what would be deleted without removing anything
npx npmdata purge --packages my-shared-assets --output ./data --dry-run
```

After a purge, the corresponding entries are removed from the `.npmdata` marker file and any empty directories are cleaned up. `.gitignore` sections written by `extract` are also removed.

## Hierarchical package resolution

`extract`, `check`, and `purge` are all hierarchy-aware: when a target package carries its own `npmdata.sets` block in its `package.json`, the command automatically recurses into those transitive dependencies.

This lets you build layered data package chains:

```
consumer project
  └─ my-org-configs          (npm package with npmdata.sets)
       ├─ base-datasets       (another npm package with its own files)
       └─ org-templates       (another npm package with its own files)
            └─ raw-assets     (leaf package)
```

Running `npx npmdata extract --packages my-org-configs --output ./data` will extract files from every package in the chain, not just `my-org-configs` itself.

### Output path resolution

Each level's `output.path` is resolved relative to the caller's own `output.path`. A package at depth 1 with `output.path: "./configs"` and a transitive dependency with `output.path: "./shared"` will land at `./configs/shared`.

### Caller overrides (extract only)

When `extract` recurses, the caller's `output` flags are inherited by every transitive dependency, with caller-defined values always winning:

| Caller sets | Effect on transitive entries |
|---|---|
| `force: true` | Transitive entries also overwrite unmanaged / foreign files |
| `dryRun: true` | No files are written anywhere in the hierarchy |
| `keepExisting: true` | Existing files are skipped at every level |
| `gitignore: false` | No `.gitignore` entries are created anywhere |
| `unmanaged: true` | All transitive files are written without a marker or read-only flag |
| `symlinks` / `contentReplacements` | Appended to each transitive entry's own lists |

Settings that are undefined on the caller are left as-is so the transitive package's own defaults apply.

### Filtering transitive sets with `selector.presets`

Set `selector.presets` on an entry to control which sets inside the target package are recursed into. Only sets whose `presets` tag overlaps with the filter are processed; sets with no `presets` are skipped when a filter is active.

```json
{
  "npmdata": {
    "sets": [
      {
        "package": "my-org-configs@^2.0.0",
        "output": { "path": "./data" },
        "selector": { "presets": ["prod"] }
      }
    ]
  }
}
```

The same filtering is applied during `check` and `purge` so they stay in sync with what `extract` originally wrote.

### Circular dependency detection

If a package chain references itself (directly or transitively), the command stops immediately with an error rather than looping forever. Sibling packages — entries already being processed at the same level — are also skipped to prevent double-processing.

## CLI reference

```
Usage:
  npx npmdata [init|extract|check|list|purge] [options]

Commands:
  init      Set up publishing configuration in a package
  extract   Extract files from a published package into a local directory
  check     Verify local files are in sync with the published package
  list      List all files managed by npmdata in an output directory
  purge     Remove all managed files previously extracted by given packages

Global options:
  --help, -h       Show help
  --version        Show version

Init options:
  --files <patterns>       Comma-separated glob patterns of files to publish
                           e.g. "docs/**,data/**,configs/*.json"
  --packages <specs>       Comma-separated additional package specs to bundle as data sources.
                           Each spec is "name" or "name@version", e.g.
                           "shared-configs@^1.0.0,base-templates@2.x".
                           Added to `dependencies` so consumers pull data from all of them.
  --output, -o <dir>       Directory to scaffold into (default: current directory)

Extract options:
  --packages <specs>       Comma-separated package specs.
                           When omitted, npmdata searches for a configuration file
                           (package.json "npmdata" key, .npmdatarc, etc.) and runs all
                           entries defined there.
                           Each spec is "name" or "name@version", e.g.
                           "my-pkg@^1.0.0,other-pkg@2.x"
  --output, -o <dir>       Output directory (default: current directory)
  --force                  Overwrite existing unmanaged files or files owned by a different package
  --keep-existing          Skip files that already exist; create them when absent. Cannot be
                           combined with --force
  --gitignore [bool]       Disable .gitignore management when set to false (enabled by default)
  --managed [bool]         Set to false to write files without a .npmdata marker, .gitignore
                           update, or read-only flag. Existing files are skipped. Files can be
                           freely edited afterwards and are not tracked by npmdata.
  --files <patterns>       Comma-separated glob patterns to filter files
  --content-regex <regex>  Regex to filter files by content
  --dry-run                Preview changes without writing any files
  --upgrade                Reinstall the package even if already present
  --silent                 Print only the final result line, suppressing per-file output
  --verbose, -v            Print detailed progress information for each step

Check options:
  --packages <specs>       Same format as extract.
                           When omitted, reads from a configuration file (see Pattern 3).
  --output, -o <dir>       Output directory to check (default: current directory)

Purge options:
  --packages <specs>       Comma-separated package names whose managed files should be removed.
                           When omitted, reads from a configuration file (see Pattern 3).
  --output, -o <dir>       Output directory to purge from (default: current directory)
  --dry-run                Simulate purge without removing any files
  --silent                 Suppress per-file output

List options:
  --output, -o <dir>       Output directory to inspect (default: current directory)
```

## Library usage

`npmdata` also exports a programmatic API:

```typescript
import { actionExtract, actionCheck, actionList, actionPurge } from 'npmdata';
import type { NpmdataExtractEntry, ProgressEvent } from 'npmdata';

const entries: NpmdataExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
];
const cwd = process.cwd();

// extract files
const result = await actionExtract({ entries, cwd });
console.log(result.added, result.modified, result.deleted);

// dry-run: preview changes without writing files
const dryResult = await actionExtract({ entries: entries.map(e => ({ ...e, output: { ...e.output, dryRun: true } })), cwd });
console.log('Would add', dryResult.added, 'files');

// track progress file-by-file
await actionExtract({
  entries,
  cwd,
  onProgress: (event: ProgressEvent) => {
    if (event.type === 'file-added')    console.log('A', event.file);
    if (event.type === 'file-modified') console.log('M', event.file);
    if (event.type === 'file-deleted')  console.log('D', event.file);
  },
});

// check sync status
const summary = await actionCheck({ entries, cwd });
const hasDrift = summary.missing.length > 0 || summary.modified.length > 0 || summary.extra.length > 0;
if (hasDrift) {
  console.log('Missing:', summary.missing);
  console.log('Modified:', summary.modified);
  console.log('Extra:', summary.extra);
}

// remove all managed files (no network required)
await actionPurge({ entries, config: null, cwd });

// list all files managed by npmdata in an output directory
const managed = await actionList({ entries, config: null, cwd });
// ManagedFileMetadata[]: Array<{ path: string; packageName: string; packageVersion: string }>
```

### `ProgressEvent` type

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end';   packageName: string; packageVersion: string }
  | { type: 'file-added';    packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted';  packageName: string; file: string }
  | { type: 'file-skipped';  packageName: string; file: string };
```

See the root [README.md](../README.md) for the full documentation.

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.npmdata` marker file in each output directory. On subsequent extractions:

- Unchanged files are skipped.
- Updated files are overwritten.
- Files removed from the package are deleted locally.

The marker file uses a `|`-delimited format; files written by older versions of `npmdata` using the comma-delimited format are read correctly for backward compatibility.

Multiple packages can coexist in the same output directory; each owns its own files.

## Developer Notes

### Module overview

| Folder / file | Purpose |
|---|---|
| `src/cli/` | CLI entry-points: argument parsing, help text, config loading, per-command handlers |
| `src/package/` | Package-level orchestration: config resolution, fileset iteration, purge and init coordination |
| `src/fileset/` | File-level extraction, diff, check, and sync logic |
| `src/types.ts` | Shared TypeScript types |
| `src/utils.ts` | Low-level utilities: package install, glob/hash helpers, package manager detection |
| `src/index.ts` | Public API surface |

### Marker file (`.npmdata`)

Each output directory that contains managed files gets a `.npmdata` CSV file. Columns: `path`, `packageName`, `packageVersion` — one row per file, no header. This is the source of truth for ownership tracking and clean removal.

### Key design decisions

- File identity is tracked by path + hash, not by timestamp, to be deterministic across machines.
- Extract uses a two-phase diff + execute model: compute all changes first, then apply them, enabling conflict detection and rollback before any file is written.
- The bin shim generated by `npmdata init` contains no logic; all behaviour is versioned inside this library.

### Dev workflow

```
make build lint-fix test
```
