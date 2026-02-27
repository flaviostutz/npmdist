SHELL := /bin/bash

build: install
	@rm -rf dist

	@# Don't bundle so internal constructs continue working on clients
	pnpm exec tsc --outDir dist

	@# remove all tests from distribution
	@-find ./dist \( -regex '.*\.test\..*' -o -regex '.*__tests.*' \) -exec rm -rf {} \; 2> /dev/null

	@# Create pack to be used by examples app to simulate real usage of the lib
	pnpm pack --pack-destination dist

lint:
	pnpm exec eslint ./src --ext .ts
	# FIXME migrate to upgraded eslint rules and re-enable this check
# 	pnpm audit --audit-level high

lint-fix:
	pnpm exec eslint . --ext .ts --fix

test-watch:
	pnpm exec jest --watch

test:
	pnpm exec jest --verbose

clean:
	rm -rf node_modules
	rm -rf dist

all: build lint test

install:
	pnpm install --frozen-lockfile --config.dedupe-peer-dependents=false

publish:
	npx -y monotag@1.26.0 current --bump-action=latest --prefix=
	@VERSION=$$(node -p "require('./package.json').version"); \
	if echo "$$VERSION" | grep -q '-'; then \
		TAG=$$(echo "$$VERSION" | sed 's/[0-9]*\.[0-9]*\.[0-9]*-\([a-zA-Z][a-zA-Z0-9]*\).*/\1/'); \
		echo "Prerelease version $$VERSION detected, publishing with --tag $$TAG to avoid it being 'latest'"; \
		npm publish --no-git-checks --provenance --tag "$$TAG"; \
	else \
		npm publish --no-git-checks --provenance; \
	fi
