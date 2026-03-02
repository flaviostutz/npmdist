# some-project-consuming-package

This is an example **consumer** project. It installs `example-files-package` (the sibling publisher example) and uses its built-in bin script to extract shared files into the local workspace.

## How it works

`example-files-package` was prepared with `npmdata init`, so it ships a `bin/npmdata.js` entry point. After installing the package, consumers can call that script directly — no separate `npmdata` invocation needed:

```sh
# extract only docs files (.gitignore entries are written by default)
pnpm exec example-files-package extract --files "docs/**/*"

# extract without writing .gitignore entries
pnpm exec example-files-package extract --files "docs/**/*" --no-gitignore

# preview what would change before writing anything
pnpm exec example-files-package extract --files "docs/**/*" --dry-run

# check whether local files are still in sync with the published package
pnpm exec example-files-package check
```

Alternatively, use `npmdata` directly and point it at the installed package:

```sh
pnpm exec npmdata extract --packages example-files-package --files "docs/**/*"
pnpm exec npmdata check  --packages example-files-package
pnpm exec npmdata list
```

## Running the example

```sh
# install the package and extract the shared files
make build
```

```sh
# full integration test: clean → install → extract → verify
make test
```

`make test` installs `example-files-package` from the locally built tarball, extracts the shared files, and then asserts the expected files are present on disk.

## Publisher side

See [`../README.md`](../README.md) for how `example-files-package` is built and published.
