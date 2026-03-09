SHELL := /bin/bash

%:
	@echo "Unknown target: $@. Ignoring"

init-publisher: install
	pnpm exec npmdata init --files "docs/**,data/**,conf/globals.js,.configs/**" --packages eslint@8

build: install
	rm -rf dist
	pnpm pack --pack-destination dist

build-dev:
	cd ../../lib; make build; cd ../examples/mypackage; make init-publisher; make build; cd ../mypackage-consumer; make test

clean:
	@rm -rf node_modules
	@rm -rf dist
	@rm -rf lib
	@rm -rf bin
	@rm package.json
	@cp package.json.orig package.json
	make clean -C ../mypackage-consumer
	make clean -C ../cli-config

test:
	echo "Running integration tests..."
	# use lib to init this project from scratch and prepare a deployable package with data
	make clean
	make init-publisher
	make build

	cd ../mypackage-consumer && make test
	cd ../cli-config && make test

install:
	# replace the dependency with the local package
	pnpm add npmdata@file:../../lib/dist/npmdata-0.0.1.tgz
	@# update local tar gz checksum
	pnpm update cdk-practical-constructs
	pnpm install

all: build test
