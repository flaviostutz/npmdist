SHELL := /bin/bash

setup: install
	pnpm exec folder-publisher init --folders docs,data

build: install
	rm -rf dist
	pnpm pack --pack-destination dist

build-dev:
	cd ../lib; make build; cd ../examples; make setup; make build

clean:
	rm -rf node_modules
	rm -rf dist

install:
	# replace the dependency with the local package
	pnpm add folder-publisher@file:../lib/dist/folder-publisher-0.0.1.tgz
	pnpm install
