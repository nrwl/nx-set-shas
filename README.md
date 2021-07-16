<p style="text-align: center;"><img src=".github/assets/nx.png" 
width="100%" alt="Nx - Smart, Extensible Build Framework"></p>

<h1 align="center">Set SHAs Action</h2>

> ✨ A Github Action which sets the base and head SHAs required for `nx affected` commands in CI

- [Example Usage](#example-usage)
- [Configuration Options](#configuration-options)
- [Background](#background)
- [License](#license)

> This documentation is for version 2.x.x. If you are using version 1.x.x you also need to include accomplanying [nx-tag-successful-ci-run](https://github.com/nrwl/nx-tag-successful-ci-run) as the last step of your job, since version 1.x.x depends on the existance of git tags that mark successful runs.

## Example Usage

**.github/workflows/ci.yml**

<!-- start example-usage -->
```yaml
# ... more CI config ...

jobs:
  primary:
    runs-on: ubuntu-latest
    name: Primary
    steps:
      - uses: actions/checkout@v2
        with:
          # We need to fetch all branches and commits so that Nx affected has a base to compare against.
          fetch-depth: 0

      # In any subsequent steps within this job (primary) we can reference the resolved SHAs
      # using either the step outputs or environment variables:

      # ===========================================================================
      # OPTION 1) Environment variables
      # ===========================================================================
      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        uses: nrwl/nx-set-shas@v2
        with:
          workflow-id: 'ci.yml'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    
      - run: |
          echo "BASE: ${{ env.NX_BASE }}"
          echo "HEAD: ${{ env.NX_HEAD }}"

      # ===========================================================================
      # OPTION 2) Step outputs (in this case we must give the step an "id")
      # ===========================================================================
      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        id: setSHAs
        uses: nrwl/nx-set-shas@v2
        with:
          workflow-id: 'ci.yml'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    
      - run: |
          echo "BASE: ${{ steps.setSHAs.outputs.base }}"
          echo "HEAD: ${{ steps.setSHAs.outputs.head }}"

      # ... more CI config ...
```
<!-- end example-usage -->

## Configuration Options

<!-- start configuration-options -->
```yaml
- uses: nrwl/nx-set-shas@v1
  env:
    # The github token needed to provide access to APIs.
    # Use ${{ secrets.GITHUB_TOKEN }} as a value
    #
    # Required: true
    GITHUB_TOKEN: ''

  with:
    # The ID of the github action workflow to check for successful run or name of the file name containing the workflow. 
    # E.g. 'ci.yml'
    #
    # Required: true
    workflow-id: ''

    # The "main" branch of your repository (the base branch which you target with PRs).
    # Common names for this branch include main and master.
    #
    # Default: main
    main-branch-name: ''

    # Applies the derived SHAs for base and head as NX_BASE and NX_HEAD environment variables within the current Job.
    #
    # Default: true
    set-environment-variables-for-job: ''

    # By default, if no successful workflow run is found on the main branch to determine the SHA, we will log a warning and use HEAD~1. Enable this option to error and exit instead.
    #
    # Default: false
    error-on-no-successful-workflow: ''
```
<!-- end configuration-options -->

## Background

When we run `affected` command on [Nx](https://nx.dev/), we can specify 2 git history positions - base and head, and it calculates [which projects in your repository changed
between those 2 commits](https://nx.dev/latest/angular/tutorial/11-test-affected-projects#step-11-test-affected-projects
). We can then run a set of tasks (like building or linting) only on those **affected** projects.

This makes it easy to set-up a CI system that scales well with the continous growth of your repository, as you add more and more projects.


### Problem

Figuring out what these two git commits are might not be as simple as it seems.

On a CI system that runs on submitted PRs, we determine what commits to include in the **affected** calculation by comparing our `HEAD-commit-of-PR-branch`to the commit in main branch (`master` or `main` usually) from which the PR branch originated. This will ensure our PR in whole is always being tested.

But what if we want to set up a continuous deployment system
that, as changes get pushed to `master`, it builds and deploys
only the affected projects?

What are the `FROM` and `TO` commits in that case?

They can't be just `HEAD` and `HEAD~1` as some of those run might fail. If a few deployments fail one after another, that means that we're accumulating a list of affected projects that are not getting deployed. Anytime we retry the deployment, we want to include **every commit since the last time we deployed successfully**. That way we ensure we don't accidentally skip deploying a project that has changed.

This action enables you to find:
* Commit SHA from which PR originated (in the case of `pull_request`)
* Commit SHA of the last successful CI run

## License

[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2021-present Narwhal Technologies Inc.
