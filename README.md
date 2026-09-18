<p style="text-align: center;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-dark.svg">
    <img alt="Nx - Smart Repos · Fast Builds" src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-light.svg" width="100%">
  </picture>
</p>

<h1 align="center">Set SHAs Action</h1>

✨ A GitHub Action which sets the base and head SHAs required for the `nx affected` commands in CI

- [Example Usage](#example-usage)
- [Configuration Options](#configuration-options)
- [Git tag matching](#git-tag-matching)
- [Permissions in v2+](#permissions-in-v2)
- [Self-hosted runners](#self-hosted-runners)
- [Background](#background)
  - [Problem](#problem)
- [License](#license)

**NOTE:** Version `2.x.x` and later uses the GitHub API to track successful workflows by default. Version `5.x.x` and later can instead use Git tags as an opt-in. You can find documentation for version `1.x.x`, which used Git tags exclusively, [here](https://github.com/nrwl/nx-set-shas/blob/v1/README.md).

## Example Usage

**.github/workflows/ci.yml**

<!-- start example-usage -->

```yaml
# ... more CI config ...

jobs:
  myjob:
    runs-on: ubuntu-latest
    name: My Job
    steps:
      - uses: actions/checkout@v6
        with:
          # We need to fetch all branches and commits so that Nx affected has a base to compare against.
          fetch-depth: 0
          filter: tree:0 # Optional, but recommended: reduce the size of the checkout with tree filtering, see https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/

      # In any subsequent steps within this job (myjob) we can reference the resolved SHAs
      # using either the step outputs or environment variables:

      # ===========================================================================
      # OPTION 1) Environment variables
      # ===========================================================================
      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        uses: nrwl/nx-set-shas@v5

      - run: |
          echo "BASE: ${{ env.NX_BASE }}"
          echo "HEAD: ${{ env.NX_HEAD }}"

      # ===========================================================================
      # OPTION 2) Step outputs (in this case we must give the step an "id")
      # ===========================================================================
      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        id: setSHAs
        uses: nrwl/nx-set-shas@v5

      - run: |
          echo "BASE: ${{ steps.setSHAs.outputs.base }}"
          echo "HEAD: ${{ steps.setSHAs.outputs.head }}"

      # ... more CI config ...
```

<!-- end example-usage -->

## Configuration Options

<!-- start configuration-options -->

```yaml
- uses: nrwl/nx-set-shas@v5
  with:
    # The GitHub token used to perform git operations
    #
    # Default: ${ github.token }
    gh-token: ''

    # The "main" branch of your repository (the base branch which you target with PRs).
    # Common names for this branch include main and master.
    #
    # Default: "main"
    main-branch-name: ''

    # The name of the remote to fetch from
    #
    # Default: "origin"
    remote: ''

    # Applies the derived SHAs for base and head as NX_BASE and NX_HEAD environment variables within the current Job.
    #
    # Default: true
    set-environment-variables-for-job: ''

    # By default, if no successful workflow run or matching Git tag is found to determine the SHA, we will log a warning and use HEAD~1. Enable this option to error and exit instead.
    #
    # Default: false
    error-on-no-successful-workflow: ''

    # Fallback SHA to use if no successful workflow run or matching Git tag is found. This can be useful in scenarios where you need a specific commit as a reference for comparison, especially in newly set up repositories or those with sparse workflow runs.
    fallback-sha: ''

    # The type of event to check for the last successful commit corresponding to that workflow-id, e.g. push, pull_request, release etc.
    #
    # Default: "push"
    last-successful-event: ''

    # The path where your repository is. This is only required for cases where the repository code is checked out or moved to a specific path.
    #
    # Default: "."
    working-directory: ''

    # The ID of the github action workflow to check for successful run or the name of the file name containing the workflow.
    # E.g. 'ci.yml'. If not provided, current workflow id will be used
    #
    workflow-id: ''

    # When using merge-group, use the previous commit in the group as the base SHA.
    #
    # Default: true
    use-previous-merge-group-commit: ''

    # Use the nearest matching Git tag reachable from HEAD as the base instead of a successful workflow run.
    #
    # Default: false
    use-git-tags: ''

    # The glob(7) pattern provided to git describe when use-git-tags is enabled.
    #
    # Default: "nx_successful_ci_run*"
    tag-match-pattern: ''
```

<!-- end configuration-options -->

## Git tag matching

Set `use-git-tags` to `true` to use a Git tag as the base for non-PR workflows. The action uses `git describe` to find the nearest matching tag reachable from `HEAD`, then resolves that tag to a commit SHA. The head remains the current `HEAD`.

```yaml
- uses: actions/checkout@v6
  with:
    # The tag lookup requires the full Git history and tags.
    fetch-depth: 0

- uses: nrwl/nx-set-shas@v5
  with:
    use-git-tags: 'true'
    tag-match-pattern: 'nx_successful_ci_run*'
```

The default pattern matches tags created for version 1 by the complementary [`nrwl/nx-tag-successful-ci-run`](https://github.com/nrwl/nx-tag-successful-ci-run) action. This action only reads tags. It does not create or push them.

Unmerged pull request workflows continue to use the PR merge base. Merge-group workflows continue to use the previous group commit when `use-previous-merge-group-commit` is enabled.

If no tag matches, `fallback-sha`, `error-on-no-successful-workflow`, and the existing `HEAD~1` fallback work as usual. The tag lookup does not require the Actions API permissions described below.

## Permissions in v2+

By default, this action uses the GitHub API to find the last successful workflow run. If your `GITHUB_TOKEN` has restrictions set, override them for the workflow to enable read access to `actions` and `contents`. If you use the action with merge queues, also enable `pull-request` permission:

<!-- start permissions-in-v2 -->

```yaml
jobs:
  myjob:
    runs-on: ubuntu-latest
    name: My Job
    permissions:
      contents: 'read'
      actions: 'read'
      pull-requests: 'read'
```

<!-- end permissions-in-v2 -->

## Self-hosted runners

This Action supports usage of your own self-hosted runners, but since it uses GitHub APIs you will need to grant it explicit access rights:

<!-- self-hosted runners -->

```yaml
# ... more CI config ...

jobs:
  myjob:
    runs-on: self-hosted
    container: my-org/my-amazing-image:v1.2.3-fresh
    name: My Job
    steps:
      - uses: actions/checkout@v6
        with:
          # We need to fetch all branches and commits so that Nx affected has a base to compare against.
          fetch-depth: 0
          filter: tree:0 # Optional, but recommended: reduce the size of the checkout with tree filtering, see https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/

      # Mark your git directory as safe
      - name: Set Directory as Safe
        run: |
          git config --system --add safe.directory "$GITHUB_WORKSPACE"
        shell: bash

      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        uses: nrwl/nx-set-shas@v5

      - run: |
          echo "BASE: ${{ env.NX_BASE }}"
          echo "HEAD: ${{ env.NX_HEAD }}"

      # ... more CI config ...
```

<!-- end self-hosted runners -->

## Background

When we run the `affected` command on [Nx](https://nx.dev/), we can specify 2 git history positions - base and head, and it calculates which projects in your repository changed between those 2 commits. We can then run a set of tasks (like building or linting) only on those **affected** projects.

This makes it easy to set up a CI system that scales well with the continuous growth of your repository, as you add more and more projects.

### Problem

Figuring out what these two git commits are might not be as simple as it seems.

On a CI system that runs on submitted PRs, we determine what commits to include in the **affected** calculation by comparing our `HEAD-commit-of-PR-branch` to the commit in the main branch (`master` or `main` usually) from which the PR branch originated. This will ensure the entirety of our PR is always being tested.

But what if we want to set up a continuous deployment system
that, as changes get pushed to `master`, builds and deploys
only the affected projects?
What are the `FROM` and `TO` commits in that case?

Conceptually, what we want is to use the absolute latest commit on the `master` branch as the HEAD, and the previous _successful_ commit on the `master` as the BASE. Note, we want the previous _successful_ one because it is still possible for commits on the `master` branch to fail for a variety of reasons.

The commits therefore can't just be `HEAD` and `HEAD~1`. If a few deployments fail one after another, that means that we're accumulating a list of affected projects that are not getting deployed. Anytime we retry the deployment, we want to include **every commit since the last time we deployed successfully**. That way we ensure we don't accidentally skip deploying a project that has changed.

This action enables you to find:

- Commit SHA from which PR originated (in the case of `pull_request`)
- Commit SHA of the last successful CI run

## License

[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2021-present Narwhal Technologies Inc.
