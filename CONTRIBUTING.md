# CONTRIBUTING

Thank you for being interested in helping with npmdata!

## The best way to start

- Look at the "Issues" and choose something to implement
- Fork this project to your account
- Implement it, create unit tests and run `make rules-doc` to update documentation
- Create a PR after you complete it to master branch
- Use make targets for common tasks (they are the same that are run during pipelines)

```sh
make build
make lint
make test
```

## Questions and discussions

- Discuss design or implementation details of a specific feature in the related Issue comments
- If you have more generic question, create a new Issue

## Bugs and feature requests

- If you find any bug, create a new Issue describing the issue
- If you want a new feature, open an Issue and explain your use case

## Prepare your development environment

- Install npm and "make" on your machine
- Git clone this repo
- Type `make build` to build the project
- Use preferably VSCode with ESLint plugin installed so linting with auto fix will be available

## Pipeline and Publishing to NPM

- Everytime a PR or a commit is made to "master" branch linting and building will be run
- Your PR will only be analysed with a successfull GH pipeline run
- When a new tag is created a GH pipeline will publish a release to NPM registry
