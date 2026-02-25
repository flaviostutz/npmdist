install:
	# copy local relative dependencies (required by local folder-publisher package)
	mkdir -p ../lib/dist
	cp -R ../../lib/dist/folder-publisher-0.0.1.tgz ../lib/dist/

	pnpm add example-files-package@file:../dist/example-files-package-1.0.0.tgz
	pnpm install

build: install
# 	pnpm exec example-files-package
	pnpm exec example-files-package extract --gitignore

test:
	# install the data package and extract the data
	make clean
	make install
	pnpm exec example-files-package extract --files "docs/**/*"

	# fail if a expected extracted file doesn't exist
	test -e docs/adrs/adr-001-sample1.md

clean:
	@rm -rf node_modules
	@rm -rf data
	@rm -rf docs
