# npmdata

Publish folders as npm packages and extract them in any workspace. Distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry.

## Getting Started

```sh
# extract files from any npm package into a local directory
npx npmdata extract --packages my-shared-assets@^2.0.0 --output ./data
```

```typescript
import { actionExtract } from 'npmdata';
import type { NpmdataExtractEntry } from 'npmdata';

const entries: NpmdataExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
];
const result = await actionExtract({ entries, cwd: process.cwd() });
console.log(result.added, result.modified, result.deleted);
```

---

## How it works

- **Publisher**: a project whose folders you want to share. Running `init` prepares its `package.json` so those folders are included when published.
- **Consumer**: any project that installs that package and runs `extract` to pull the files locally. A `.npmdata` marker file tracks ownership and enables safe updates.

---

## Scenario 1 — Ad-hoc CLI extraction

Pull files directly without any setup:

```sh
npx npmdata extract --packages my-shared-assets@^2.0.0 --output ./data

# filter by glob pattern
npx npmdata extract --packages my-shared-assets --files "**/*.md" --output ./docs

# filter by file content
npx npmdata extract --packages my-shared-assets --content-regex "env: production" --output ./configs

# preview without writing
npx npmdata extract --packages my-shared-assets --output ./data --dry-run
```

---

## Scenario 2 — Config file in your project

Declare sources in `.npmdatarc` (or `package.json`) and run `extract` without `--packages`:

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

```sh
npx npmdata extract   # reads config, extracts all sets
npx npmdata check     # verifies files are in sync
npx npmdata purge     # removes all managed files
```

After `extract`, the output directory will contain the selected files alongside a `.npmdata` marker file that tracks ownership and enables safe updates:

```
./data/
  datasets/
    sample.csv
    labels.csv
  .npmdata              ← tracks file ownership (package name + version)
```

Config is resolved looking at files: `package.json` (`"npmdata"` key), `.npmdatarc`, `.npmdatarc.json`, `.npmdatarc.yaml`, or `npmdata.config.js`. Pass `--config <file>` to point to an explicit config file and skip auto-discovery.

---

## Scenario 3 — Data package (curated bundle for consumers)

A data package bundles, filters, and versions content from multiple upstream sources. Consumers install it and run one command — no knowledge of the internals required.

**Step 1 — Create the data package**

```sh
# in the data package directory
pnpm dlx npmdata init --files "docs/**,data/**"

# also pull from upstream packages
pnpm dlx npmdata init --files "docs/**" --packages "shared-configs@^1.0.0,base-templates@2.x"
```

`init` updates `package.json` with the right `files`, `bin`, and `dependencies` and writes a `bin/npmdata.js` entry point. Then:

```sh
npm publish
```

**Step 2 — Add configuration to the data package's `package.json`**

```json
{
  "name": "my-org-configs",
  "version": "1.0.0",
  "npmdata": {
    "sets": [
      {
        "package": "base-datasets@^3.0.0",
        "selector": { "files": ["datasets/**"] },
        "output": { "path": "./data/base" },
        "presets": ["prod"]
      },
      {
        "package": "org-configs@^1.2.0",
        "selector": {
          "contentRegexes": ["env: production"],
          "presets": ["reports"]
        },
        "output": { "path": "./configs" },
        "presets": ["prod", "staging"]
      }
    ]
  }
}
```

> **`presets` vs `selector.presets`**
> - `sets[].presets` — tags **this entry** so it is only processed when `--presets <tag>` matches. Use this in a consumer config to pick which source packages to extract.
> - `sets[].selector.presets` — filters which of the **target package's own** `npmdata.sets` are recursively extracted. Only the nested sets inside the target package whose `presets` fields match will run.

**Step 3 — Consumer installs and runs**

```sh
# Extract all files from this curated package to current dir
npx my-org-configs extract

# limit to a preset
npx my-org-configs extract --output ./local-data --presets prod
```

---

## All extract options

```sh
npx npmdata extract --packages my-pkg@^2.0.0 --output ./data   # specific version
npx npmdata extract --packages "pkg-a,pkg-b@1.x" --output ./data  # multiple packages
npx npmdata extract --packages my-pkg --output ./data --force   # overwrite unmanaged files
npx npmdata extract --packages my-pkg --output ./data --managed=false  # skip tracking
npx npmdata extract --packages my-pkg@latest --output ./data --upgrade  # force reinstall
npx npmdata extract --packages my-pkg --output ./data --gitignore=false  # skip .gitignore
npx npmdata extract --packages my-pkg --output ./data --dry-run  # preview only
```

`extract` logs every file change:
```
A  data/users-dataset/user1.json
M  data/configs/app.config.json
D  data/old-file.json
```

---

## Check, list, purge and presets

`check`, `purge`, and `extract` are all **hierarchy-aware**: when a target package carries its own `npmdata.sets` block, the command automatically recurses into those transitive dependencies. See [Hierarchical package resolution](#hierarchical-package-resolution) for the full details.

```sh
# verify files are in sync (exit 0 = ok, exit 1 = drift or error)
npx npmdata check --packages my-shared-assets --output ./data

# list all managed files grouped by package
npx npmdata list --output ./data

# remove managed files (no network required)
npx npmdata purge --packages my-shared-assets --output ./data
npx npmdata purge --packages my-shared-assets --output ./data --dry-run

# list all preset tags defined in your configuration
npx npmdata presets
```

---

## Entry options reference

Each entry in `npmdata.sets` supports:

| Option | Type | Default | Description |
|---|---|---|---|
| `package` | `string` | required | Package spec: `my-pkg` or `my-pkg@^1.2.3` |
| `presets` | `string[]` | none | Tags this entry so it is included only when the matching `--presets <tag>` flag is used. Listed by `npmdata presets` |
| `output.path` | `string` | `.` (cwd) | Extraction directory, relative to where the command runs |
| `selector.files` | `string[]` | all files | Glob patterns to filter extracted files |
| `selector.contentRegexes` | `string[]` | none | Regex patterns to filter files by content |
| `selector.exclude` | `string[]` | none | Glob patterns to exclude files even if they match `selector.files` |
| `selector.presets` | `string[]` | none | Filters which of the **target package's own** `npmdata.sets` are recursively extracted. Only sets in the target whose `presets` matches are processed. Does not affect which files are selected from the target package itself |
| `selector.upgrade` | `boolean` | `false` | Force fresh package install even if a satisfying version is already installed |
| `output.force` | `boolean` | `false` | Overwrite unmanaged or foreign-owned files |
| `output.keepExisting` | `boolean` | `false` | Skip files that already exist; create them when absent |
| `output.gitignore` | `boolean` | `true` | Write `.gitignore` alongside managed files |
| `output.unmanaged` | `boolean` | `false` | Write files without tracking (no marker, no read-only) |
| `output.dryRun` | `boolean` | `false` | Simulate without writing |
| `output.symlinks` | `SymlinkConfig[]` | none | Post-extract symlink operations |
| `output.contentReplacements` | `ContentReplacementConfig[]` | none | Post-extract content replacements |

### SymlinkConfig

Creates symlinks after extraction. Stale symlinks pointing into `output.path` are removed automatically.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Glob relative to `output.path` |
| `target` | `string` | Directory for symlinks, relative to project root |

### ContentReplacementConfig

Applies regex replacements to workspace files after extraction.

| Field | Type | Description |
|---|---|---|
| `files` | `string` | Glob selecting files to modify |
| `match` | `string` | Regex locating the text to replace |
| `replace` | `string` | Replacement string (supports `$1` back-references) |

---

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

Running `npx npmdata extract --packages my-org-configs --output ./data` extracts files from every package in the chain, not just `my-org-configs` itself. Running `check` or `purge` with the same arguments mirrors what `extract` originally covered.

### Output path resolution

Each level’s `output.path` is resolved relative to the caller’s own `output.path`. A package at depth 1 with `output.path: "./configs"` that has a transitive dependency with `output.path: "./shared"` will land at `./configs/shared`.

### Caller overrides (extract only)

When `extract` recurses, the calling entry’s `output` flags are inherited by every transitive dependency, with caller-defined values always winning:

| Caller sets | Effect on transitive entries |
|---|---|
| `force: true` | Transitive entries also overwrite unmanaged / foreign files |
| `dryRun: true` | No files are written anywhere in the hierarchy |
| `keepExisting: true` | Existing files are skipped at every level |
| `gitignore: false` | No `.gitignore` entries are created anywhere |
| `unmanaged: true` | All transitive files are written without a marker or read-only flag |
| `symlinks` / `contentReplacements` | Appended to each transitive entry’s own lists |

Settings that are undefined on the caller are left as-is so the transitive package’s own defaults apply.

### Filtering transitive sets with `selector.presets`

Set `selector.presets` on an entry to control which sets inside the target package are recursed into (applies to `extract`, `check`, and `purge`). Only sets whose `presets` tag overlaps with the filter are processed; sets with no `presets` are skipped when a filter is active.

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

### Circular dependency detection

If a package chain references itself, the command stops immediately with an error. Sibling packages — entries already being processed at the same level — are also skipped to prevent double-processing.

---

## CLI reference

```
Usage:
  npx npmdata [init|extract|check|list|purge|presets] [options]

Init:     --files <patterns>    Glob patterns of files to publish
          --packages <specs>    Additional upstream packages to bundle
          --output, -o <dir>    Directory to scaffold into (default: cwd)

Extract:  --packages <specs>    Package specs (omit to read from config file)
          --output, -o <dir>    Output directory (default: cwd)
          --files <patterns>    Filter files by glob
          --content-regex <rx>  Filter files by content
          --force               Overwrite unmanaged/foreign files
          --keep-existing       Skip existing files
          --gitignore [bool]    Disable .gitignore management when set to false
          --managed [bool]      Write without tracking when set to false
          --dry-run             Preview without writing
          --upgrade             Reinstall even if present
          --presets <tags>      Only process entries matching these preset tags
          --config <file>       Explicit config file path (overrides auto-discovery)
          --verbose, -v         Detailed progress output
          --silent              Final result line only

Check:    --packages <specs>    Same format as extract
          --output, -o <dir>    Directory to check
          --presets <tags>      Only check entries matching these preset tags
          --config <file>       Explicit config file path (overrides auto-discovery)

Purge:    --packages <specs>    Package names to purge
          --output, -o <dir>    Directory to purge from
          --dry-run             Preview without deleting
          --presets <tags>      Only purge entries matching these preset tags
          --config <file>       Explicit config file path (overrides auto-discovery)
          --silent              Suppress per-file output

List:     --output, -o <dir>    Directory to inspect
          --config <file>       Explicit config file path (overrides auto-discovery)

Presets:  --config <file>       Explicit config file path (overrides auto-discovery)
                                Lists all preset tags defined in configuration,
                                sorted alphabetically, one per line
```

---

## Programmatic API

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

// track progress
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

// remove managed files (no network required)
await actionPurge({ entries, config: null, cwd });

// list managed files
const managed = await actionList({ entries, config: null, cwd });
// ManagedFileMetadata[]: Array<{ path: string; packageName: string; packageVersion: string }>
```

### ProgressEvent

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end';   packageName: string; packageVersion: string }
  | { type: 'file-added';    packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted';  packageName: string; file: string }
  | { type: 'file-skipped';  packageName: string; file: string };
```

### postExtractScript

Set `postExtractScript` at the top level of your config to run a shell command after a successful (non-dry-run) `extract`. The full argv of the extract call is appended automatically.

```json
{
  "npmdata": {
    "postExtractScript": "node scripts/post-extract.js",
    "sets": []
  }
}
```

---

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.npmdata` marker file per output directory. On subsequent extractions, unchanged files are skipped, updated files are overwritten, and files removed from the package are deleted locally. Multiple packages can coexist in the same output directory — each owns its files.

See [examples/](examples/) for working samples.
