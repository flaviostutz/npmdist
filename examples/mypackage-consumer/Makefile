install:
	# copy local relative dependencies (required by local npmdata package)
	mkdir -p ../lib/dist
	cp -R ../../lib/dist/npmdata-0.0.1.tgz ../lib/dist/

	pnpm add example-files-package@file:../mypackage/dist/example-files-package-1.0.0.tgz
	pnpm install

build: install
# 	pnpm exec example-files-package
# 	pnpm exec example-files-package extract --files "docs/**/*,conf/**/*" --output output

test: clean install
	@echo ">>>> mypackage-consumer"
	pnpm exec example-files-package extract --output output

	# fail if a expected extracted file doesn't exist
	test -e output/.configs/app.config.json
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js

	pnpm exec example-files-package check --output output

	pnpm exec example-files-package list --output output

	pnpm exec example-files-package purge --output output
	test ! -e output/.configs/app.config.json
	test ! -e output/docs/adrs/adr-001-sample1.md

	pnpm exec example-files-package --output output

clean:
	@rm -rf node_modules
	@rm -rf output
