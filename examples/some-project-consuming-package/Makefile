install:
	# copy local relative dependencies (required by local folder-publisher package)
	mkdir -p ../lib/dist
	cp -R ../../lib/dist/folder-publisher-0.0.1.tgz ../lib/dist/

	pnpm add example-files-package@file:../dist/example-files-package-1.0.0.tgz
	pnpm install

extract-example-data: install
	pnpm exec example-files-package
