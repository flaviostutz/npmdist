# project-using-config-file

This example demonstrates using **npmdata** via a local configuration file rather than passing
`--packages` on every command. It shows that `npmdata extract`, `npmdata check`, and `npmdata purge`
all work without `--packages` when a configuration is detected automatically.

## How it works

When `--packages` is omitted from an `extract`, `check`, or `purge` command, the `npmdata` CLI
searches for a configuration using [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) in the
following order (starting from the current working directory):

| Location | Format |
|---|---|
| `package.json` → `"npmdata"` key | JSON object with `"sets"` array |
| `.npmdatarc` | JSON or YAML object with `"sets"` array |
| `.npmdatarc.json` | JSON object with `"sets"` array |
| `.npmdatarc.yaml` / `.npmdatarc.yml` | YAML object with `"sets"` array |
| `npmdata.config.js` | CommonJS module exporting object with `sets` array |

Each entry in the `sets` array supports the same fields as a data-package `"npmdata.sets"` array entry.

## Configuration approaches

### Option A – package.json

```json
{
  "name": "my-project",
  "npmdata": {
    "sets": [
      {
        "package": "example-files-package",
        "outputDir": "output",
        "files": ["docs/**", "data/**"]
      }
    ]
  }
}
```

### Option B – .npmdatarc

```json
{
  "sets": [
    {
      "package": "example-files-package",
      "outputDir": "output",
      "files": ["docs/**", "data/**"]
    }
  ]
}
```

## Running the example

```bash
# installs dependencies (requires examples/ to be built first)
make install

# extracts files – no --packages argument needed
pnpm exec npmdata extract

# verifies local files are in sync
pnpm exec npmdata check

# removes all managed files
pnpm exec npmdata purge
```

## Running the integration test

```bash
make test
```

This runs the full test cycle twice – once reading the configuration from `package.json` and once
from a temporary `.npmdatarc` file – to verify that both configuration sources work correctly.

## Entry format reference

Each entry supports the same fields as a data-package `"npmdata.sets"` array entry:

| Field | Type | Description |
|---|---|---|
| `package` | `string` | Package name/spec to extract from (e.g. `"my-pkg"` or `"my-pkg@^1.0.0"`) |
| `outputDir` | `string` | Directory to extract files into (relative to cwd) |
| `files` | `string[]` | Glob patterns to filter which files are extracted |
| `tags` | `string[]` | Optional tags for filtering with `--tags` |
| `force` | `boolean` | Overwrite existing unmanaged files |
| `keepExisting` | `boolean` | Skip files that already exist |
| `gitignore` | `boolean` | Manage `.gitignore` (default: `true`) |
| `unmanaged` | `boolean` | Write without `.npmdata` marker |
| `dryRun` | `boolean` | Simulate without writing |
| `silent` | `boolean` | Suppress per-file output |
| `verbose` | `boolean` | Print detailed progress |
