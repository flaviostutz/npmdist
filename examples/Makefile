SHELL := /bin/bash

init-publisher: install
	pnpm exec folder-publisher init --folders docs,data

build: install
	rm -rf dist
	pnpm pack --pack-destination dist

build-dev:
	cd ../lib; make build; cd ../examples; make init-publisher; make build

clean:
	@rm -rf node_modules
	@rm -rf dist
	@rm -rf lib
	@rm -rf bin
	@rm package.json
	@cp package.json.orig package.json

test:
	echo "Running integration tests..."
	# use lib to init this project from scratch and prepare a deployable package with data
	make clean
	make init-publisher
	make build

	cd project-using-example-package; make test

install:
	# replace the dependency with the local package
	pnpm add folder-publisher@file:../lib/dist/folder-publisher-0.0.1.tgz
	pnpm install

lint:
	echo "Nothing to lint. Ignoring"

