# npmdata

Publish folders as npm packages and extract them in any workspace. Use it to distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry.

## How it works

- **Publisher**: a project that has folders to share. Running `init` prepares its `package.json` so those folders are included when the package is published.
- **Consumer**: any project that installs that package and runs `extract` to download the files locally. A `.publisher` marker file is written alongside the managed files to track ownership and enable safe updates.

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

# skip .gitignore entries for managed files (gitignore is enabled by default)
pnpm dlx npmdata init --files "docs/**,data/**" --no-gitignore

# mark extracted files as unmanaged so consumers can edit them freely;
# files won't be tracked, made read-only, or added to .gitignore
pnpm dlx npmdata init --files "templates/**" --unmanaged
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
npx npmdata extract --packages my-shared-assets --output ./data --no-gitignore

# write files without a .npmdata marker or .gitignore entry; files won't be read-only
# and won't be tracked by npmdata; existing files are left unchanged
npx npmdata extract --packages my-shared-assets --output ./data --unmanaged

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

When the data package defines multiple `npmdata` entries in its `package.json`, you can limit which entries are processed using the `--tags` option. Only entries whose `tags` list includes at least one of the requested tags will be extracted; entries with no tags are skipped when a tag filter is active.

```sh
# run only entries tagged with "prod"
npx my-shared-assets --tags prod

# run entries tagged with either "prod" or "staging"
npx my-shared-assets --tags prod,staging
```

To use tags, add a `tags` array to each `npmdata` entry in the data package's `package.json`:

```json
{
  "npmdata": [
    { "package": "my-shared-assets", "outputDir": "./data", "tags": ["prod"] },
    { "package": "my-dev-assets",    "outputDir": "./dev-data", "tags": ["dev", "staging"] }
  ]
}
```

Check the /examples folder to see this in action

### 3. Check files are in sync

```sh
npx npmdata check --packages my-shared-assets --output ./data
# exit 0 = in sync, exit 2 = differences found

# check multiple packages
npx npmdata check --packages "my-shared-assets,another-pkg" --output ./data
```

The check command reports differences per package:

```
my-shared-assets@^2.0.0  FAIL
  missing:   data/new-file.json
  modified:  data/configs/app.config.json
  extra:     data/old-file.json
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

## CLI reference

```
Usage:
  npx npmdata [init|extract|check|list] [options]

Commands:
  init      Set up publishing configuration in a package
  extract   Extract files from a published package into a local directory
  check     Verify local files are in sync with the published package
  list      List all files managed by npmdata in an output directory

Global options:
  --help, -h       Show help
  --version, -v    Show version

Init options:
  --files <patterns>       Comma-separated glob patterns of files to publish (required)
                           e.g. "docs/**,data/**,configs/*.json"
  --packages <specs>       Comma-separated additional package specs to bundle as data sources.
                           Each spec is "name" or "name@version", e.g.
                           "shared-configs@^1.0.0,base-templates@2.x".
                           Listed under `npmdata.additionalPackages` in package.json and
                           added to `dependencies` so consumers pull data from all of them.
  --no-gitignore           Skip adding .gitignore entries for managed files
                           (gitignore is enabled by default)
  --unmanaged              Mark all generated npmdata entries as unmanaged: extracted files
                           are written without a .npmdata marker, without updating .gitignore,
                           and without being made read-only. Existing files are skipped.

Extract options:
  --packages <specs>       Comma-separated package specs (required).
                           Each spec is "name" or "name@version", e.g.
                           "my-pkg@^1.0.0,other-pkg@2.x"
  --output, -o <dir>       Output directory (default: current directory)
  --force                  Overwrite existing unmanaged files or files owned by a different package
  --no-gitignore            Skip creating/updating .gitignore (gitignore is enabled by default)
  --unmanaged              Write files without a .npmdata marker, .gitignore update, or read-only
                           flag. Existing files are skipped. Files can be freely edited afterwards
                           and are not tracked by npmdata.
  --files <patterns>       Comma-separated glob patterns to filter files
  --content-regex <regex>  Regex to filter files by content
  --dry-run                Preview changes without writing any files
  --upgrade                Reinstall the package even if already present

Check options:
  --packages <specs>       Same format as extract (required)
  --output, -o <dir>       Output directory to check (default: current directory)

List options:
  --output, -o <dir>       Output directory to inspect (default: current directory)
```

## Library usage

`npmdata` also exports a programmatic API:

```typescript
import { extract, check, list, initPublisher, parsePackageSpec, isBinaryFile } from 'npmdata';
import type { ConsumerConfig, ConsumerResult, CheckResult, ProgressEvent } from 'npmdata';

// extract files from one package
const result = await extract({
  packages: ['my-shared-assets@^2.0.0'],
  outputDir: './data',
  gitignore: true,
});
console.log(result.added, result.modified, result.deleted);

// dry-run: preview changes without writing files
const preview = await extract({
  packages: ['my-shared-assets@^2.0.0'],
  outputDir: './data',
  dryRun: true,
});
console.log('Would add', preview.added, 'files');

// force-reinstall the package even if already present
await extract({
  packages: ['my-shared-assets@latest'],
  outputDir: './data',
  upgrade: true,
});

// extract without npmdata tracking: files are writable, no .npmdata marker is written,
// no .gitignore entry is created. Existing files are left untouched (skipped).
await extract({
  packages: ['shared-templates'],
  outputDir: './templates',
  unmanaged: true,
});

// track progress file-by-file
await extract({
  packages: ['my-shared-assets@^2.0.0'],
  outputDir: './data',
  onProgress: (event: ProgressEvent) => {
    if (event.type === 'file-added')   console.log('A', event.file);
    if (event.type === 'file-modified') console.log('M', event.file);
    if (event.type === 'file-deleted') console.log('D', event.file);
  },
});

// extract files from multiple packages into the same output directory
const multiResult = await extract({
  packages: ['my-shared-assets@^2.0.0', 'another-pkg@1.x'],
  outputDir: './data',
});

// check sync status — per-package breakdown
const status = await check({
  packages: ['my-shared-assets'],
  outputDir: './data',
});
if (!status.ok) {
  console.log('Overall differences:', status.differences);
  for (const pkg of status.sourcePackages) {
    if (!pkg.ok) {
      console.log(pkg.name, 'missing:', pkg.differences.missing);
      console.log(pkg.name, 'modified:', pkg.differences.modified);
      console.log(pkg.name, 'extra:', pkg.differences.extra);
    }
  }
}

// list all files managed by npmdata in an output directory
const managed = await list('./data');
// managed is Record<string, string[]> keyed by "package@version"

// initialize a publisher package
await initPublisher(['docs', 'data'], { workingDir: './my-package' });

// utility: parse a package spec string
const { name, version } = parsePackageSpec('my-pkg@^1.0.0');

// utility: detect whether a file is binary
const binary = isBinaryFile('/path/to/file.bin');
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

See [lib/README.md](lib/README.md) for the full API reference.

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.publisher` marker file in each output directory. On subsequent extractions:

- Unchanged files are skipped.
- Updated files are overwritten.
- Files removed from the package are deleted locally.

The marker file uses a `|`-delimited format; files written by older versions of `npmdata` using the comma-delimited format are read correctly for backward compatibility.

Multiple packages can coexist in the same output directory; each owns its own files.

## Developer Notes

### Module overview

| Module | Purpose |
|---|---|
| `publisher.ts` | `initPublisher()` — scaffolds a publishable package (updates `package.json`, generates bin script) |
| `consumer.ts` | `extract()` and `check()` — installs a package from the registry, copies files, manages marker files |
| `runner.ts` | Entry point injected into the generated bin script; delegates to the CLI |
| `cli.ts` / `main.ts` | CLI parsing and top-level entry point |
| `utils.ts` | File I/O helpers: glob matching via `minimatch`, SHA-256 hashing, CSV marker read/write, package manager detection |
| `types.ts` | Shared TypeScript types and constants (e.g. `DEFAULT_FILENAME_PATTERNS`) |

### Publish side (`publisher.ts`)

`initPublisher()` modifies the target `package.json` to include `files`, `bin`, and `dependencies` fields, then writes a thin `bin/npmdata.js` that calls `runner.run(__dirname)`. The generated script is kept minimal on purpose — all logic lives in this library.

### Consumer side (`consumer.ts`)

`extract()` flow:
1. Detects the package manager (`pnpm` / `yarn` / `npm`) via lock-file presence.
2. For each entry in `config.packages`, parses the spec (`name` or `name@version`) and runs `<pm> add <package>@<version>` to resolve the package.
3. Iterates matching files (glob + optional content regex) from each installed package.
4. Copies files into `outputDir`, tracking state in a `.publisher` CSV marker file per output directory.
5. Optionally writes a `.gitignore` section around the managed files.

`check()` performs the same resolution for each package in `config.packages` but compares SHA-256 hashes without writing any files.

### Marker file (`.publisher`)

Each output directory that contains managed files gets a `.publisher` CSV file. Columns: `path`, `packageName`, `packageVersion`, `sha256`. This is the source of truth for drift detection and clean removal.

### Key design decisions

- No runtime dependencies beyond `semver` and `minimatch` to keep the consumer install footprint small.
- File identity is tracked by path + hash, not by timestamp, to be deterministic across machines.
- The bin script generated by `initPublisher` contains no logic; all behaviour is versioned inside this library.

### Dev workflow

```
make build lint-fix test
```
