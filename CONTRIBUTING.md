# Contributing

## Prerequisites

For development purposes, this repo uses `bun` as a package manager, bundler and TypeScript script runner.

You can install `bun` by following the instruction on https://bun.com/

## Development

- Run `bun install` to install the dependencies.
- Run `bun run build` to build the action.
- Run `bun run format` to format the code. This is also done automatically by the pre-commit hook (please do not skip it).

# Notes to Admins

In order to publish a new version of the action, simply update the "version" in the package.json and merge into the main branch.

If your changed files include `find-successful-workflow.ts`, then you should also update the bundle in the `dist` folder using `npm run build`.

The workflow at `./github/workflows/publish.yml` will apply the new version in the form of tags, which is all that is needed to publish an Action.

Example of tags applied:

- Let's say that the new version you have applied is `1.2.3`.
- The commit will be tagged with `v1.2.3` as you would expect, but it will also be tagged with `v1.2` and `v1`. This is so that we are effectively moving the "head" of these major and minor versions up to the latest patch release which is relevant to them, meaning users can have workflows which specify only `v1` or `v1.2` and always be ensured that they are receiving the latest and greatest.
