SHELL := /bin/bash

install:
	# copy local relative dependencies (required by local npmdata package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/npmdata-0.0.1.tgz ../lib/dist/

	pnpm add npmdata@file:../lib/dist/npmdata-0.0.1.tgz
	pnpm install --no-frozen-lockfile

test:
	make clean
	make install

	# --- Test 1: config from package.json "npmdata" key ---
	# extract without --packages: reads entries from the "npmdata" key in package.json
	pnpm exec npmdata extract
	test -e output/docs/README.md
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/data/users-dataset/user1.json
	test -e output/eslint/conf/globals.js

	# check without --packages: reads entries from package.json
	pnpm exec npmdata check

	# purge without --packages: reads entries from package.json
	pnpm exec npmdata purge
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
#	eslint is unmanaged, so it should still be present after purge
	test -e output/eslint/conf/globals.js

	# --- Test 2: config from .npmdatarc ---
	# temporarily move the "npmdata" field out of package.json and write .npmdatarc
	jq '.npmdata' package.json > .npmdatarc
	jq 'del(.npmdata)' package.json > package.json.tmp && mv package.json.tmp package.json

	pnpm exec npmdata extract
	test -e output/docs/README.md
	test -e output/data/users-dataset/user1.json
	test -e output/eslint/conf/globals.js

	pnpm exec npmdata check
	test -e output/docs/README.md
	pnpm exec npmdata purge
	test ! -e output/docs/README.md
# 	unmanaged should be left behind without purge
	test -e output/eslint/conf/globals.js

	# restore original package.json
	jq --slurpfile npmdata .npmdatarc '. + {npmdata: $$npmdata[0]}' package.json > package.json.tmp && mv package.json.tmp package.json
	rm .npmdatarc

	# --- Test 3: tags filtering via config ---
	rm -rf output
	pnpm exec npmdata extract --tags "basic"
	# basic-tagged entry (example-files-package docs and data) should be extracted
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/data/users-dataset/user1.json
	# extra-tagged entry (eslint) should not be extracted
	test ! -e output/eslint/conf/globals.js
	pnpm exec npmdata check --tags "basic"
	pnpm exec npmdata purge --tags "basic"
	test ! -e output/docs/adrs/adr-001-sample1.md
	test ! -e output/data/users-dataset/user1.json

	@echo "All config-file mode tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -f pnpm-lock.yaml
	@rm -f .npmdatarc
	@cp -f package.json.orig package.json
