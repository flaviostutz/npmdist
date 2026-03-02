# example-files-package

This is an example **publisher** project. It packages shared `docs/` and `data/` folders as an npm package using `npmdata`, so any consumer project can install and extract those files locally.

The `project-using-example-package/` sub-directory is an example **consumer** that installs this package and extracts its files.

## Directory layout

```
docs/          shared documentation and ADRs published with this package
data/          shared datasets published with this package
bin/npmdata.js generated entry point script (created by `npmdata init`)
```

## How to set up a publisher package from scratch

Run `npmdata init` once to configure `package.json` so that the right folders are included on publish:

```sh
pnpm dlx npmdata init --files "docs/**,data/**"
```

This updates `package.json` with:
- `files` — globs that include the shared folders in the tarball
- `bin` — a thin `bin/npmdata.js` script consumers can call directly
- `dependencies` — pins the `npmdata` runtime needed by that script

Then publish as any normal npm package:

```sh
npm publish
```

## Running the example locally

The `Makefile` automates the full publisher + consumer cycle against the local `npmdata` build:

```sh
# build this package into a local tarball and run the consumer integration test
make test
```

`make test` performs:
1. Cleans previous build artefacts
2. Re-initialises the publisher configuration (`npmdata init`)
3. Packs the package into `dist/`
4. Switches to `project-using-example-package/` and runs its own `make test`

## Consumer side

See [`project-using-example-package/README.md`](project-using-example-package/README.md) for how a consumer installs and extracts files from this package.
