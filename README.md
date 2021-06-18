# nx-set-shas

## Usage

<!-- start usage -->
```yaml
- uses: nrwl/nx-set-shas@v1
  with:
    # The "main" branch of your repository (the base branch which you target with PRs).
    # Common names for this branch include main and master.
    #
    # Default: main
    main-branch-name: ''

    # The glob(7) pattern to be provided to `git describe --match` in order to match against
    # the latest relevant tag on the specified "main" branch.
    #
    # The default pattern aligns with the default behavior of the complementary `nrwl/nx-tag-successful-ci-run` action.
    #
    # Default: nx_successful_ci_run*
    tag-match-pattern: ''

    # Applies the derived SHAs for base and head as NX_BASE and NX_HEAD environment variables within the current Job.
    #
    # Default: true
    set-environment-variables-for-job: ''

    # By default, if no matching tags are found on the main branch to determine the SHA, we will log a warning and use HEAD~1. Enable this option to error and exit instead.
    #
    # Default: false
    error-on-no-matching-tags: ''
```
<!-- end usage -->