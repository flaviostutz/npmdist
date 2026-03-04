install:
	# copy local relative dependencies (required by local npmdata package)
	mkdir -p ../lib/dist
	cp -R ../../lib/dist/npmdata-0.0.1.tgz ../lib/dist/

	pnpm add example-files-package@file:../dist/example-files-package-1.0.0.tgz
	pnpm install

build: install
# 	pnpm exec example-files-package
	pnpm exec example-files-package extract --files "docs/**/*,conf/**/*" --output output

test:
	# install the data package and extract the data
	make clean
	make install
	pnpm exec example-files-package extract --output output

	# fail if a expected extracted file doesn't exist
	test -e output/.configs/app.config.json
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js

	pnpm exec example-files-package extract --tags "basic" --output output
# 	fail if basic-tagged files are not present, and extra-tagged files are purged
	test -e output/docs/adrs/adr-001-sample1.md
	test ! -e output/conf/globals.js

	pnpm exec example-files-package --tags "basic" --output output
	test -e output/.configs/app.config.json

	pnpm exec example-files-package check --tags "basic" --output output

	pnpm exec example-files-package list --output output

	pnpm exec example-files-package purge --output output
	test ! -e output/.configs/app.config.json
	test ! -e output/docs/adrs/adr-001-sample1.md

	pnpm exec example-files-package --tags "basic" --output output

clean:
	@rm -rf node_modules
	@rm -rf output
