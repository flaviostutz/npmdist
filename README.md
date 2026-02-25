# folder-publisher

Publish folders as npm packages and extract them in any workspace. Use it to distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry.

## How it works

- **Publisher**: a project that has folders to share. Running `init` prepares its `package.json` so those folders are included when the package is published.
- **Consumer**: any project that installs that package and runs `extract` to download the files locally. A `.publisher` marker file is written alongside the managed files to track ownership and enable safe updates.

## Quick start

### 1. Prepare the publisher package

In the project whose folders you want to share:

```sh
pnpm dlx folder-publisher init --folders "docs,data,configs"
```

This updates `package.json` with the right `files`, `bin`, and `dependencies` fields. Then publish normally:

Add files in /docs, /data and /configs. Those are the files being shared using this utility.

```sh
npm publish
```

### 2. Extract files in a consumer project

```sh
# extract all files from the package
npx folder-publisher extract --package my-shared-assets --output ./data

# extract a specific version
npx folder-publisher extract --package my-shared-assets --version "^2.0.0" --output ./data

# extract only markdown files
npx folder-publisher extract --package my-shared-assets --files "**/*.md" --output ./docs

# also write .gitignore entries for managed files
npx folder-publisher extract --package my-shared-assets --output ./data --gitignore
```

If the published package includes its own bin script (normally when it's prepared using "init") you can also call it directly so it extracts data that is inside the package itself:

```sh
npx my-shared-assets extract --output ./data
npx my-shared-assets check  --output ./data
```

Check the /examples folder to see this in action

### 3. Check files are in sync

```sh
npx folder-publisher check --package my-shared-assets --output ./data
# exit 0 = in sync, exit 2 = differences found
```

## CLI reference

```
Usage:
  npx folder-publisher [init|extract|check] [options]

Commands:
  init      Set up publishing configuration in a package
  extract   Extract files from a published package into a local directory
  check     Verify local files are in sync with the published package

Global options:
  --help, -h       Show help
  --version, -v    Show version

Init options:
  --folders <list>         Comma-separated folders to publish (required)

Extract / Check options:
  --package, -p <name>     Package name (required)
  --version <constraint>   Semver constraint, e.g. "^1.0.0"
  --output, -o <dir>       Output directory (default: current directory)
  --force                  Overwrite existing unmanaged files
  --gitignore              Create/update .gitignore for managed files
  --files <patterns>       Comma-separated glob patterns to filter files
  --content-regex <regex>  Regex to filter files by content
```

## Library usage

`folder-publisher` also exports a programmatic API:

```typescript
import { extract, check, initPublisher } from 'folder-publisher';

// extract files
const result = await extract({
  packageName: 'my-shared-assets',
  version: '^2.0.0',
  outputDir: './data',
  gitignore: true,
});
console.log(result.added, result.modified, result.deleted);

// check sync status
const status = await check({
  packageName: 'my-shared-assets',
  outputDir: './data',
});
if (!status.ok) console.log(status.differences);

// initialize a publisher package
await initPublisher(['docs', 'data'], { workingDir: './my-package' });
```

See [lib/README.md](lib/README.md) for the full API reference.

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.publisher` marker file in each output directory. On subsequent extractions:

- Unchanged files are skipped.
- Updated files are overwritten.
- Files removed from the package are deleted locally.

Multiple packages can coexist in the same output directory; each owns its own files.

## License

MIT
