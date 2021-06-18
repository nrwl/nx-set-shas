# nx-set-shas

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
          # We need to fetch all branches and commits so that Nx affected as a base to compare against.
          fetch-depth: 0

      # In any subsequent steps within this job (primary) we can reference the resolved SHAs
      # using either the step outputs or environment variables:

      # ===========================================================================
      # OPTION 1) Environment variables
      # ===========================================================================
      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        uses: nrwl/nx-set-shas@v1
    
      - run: |
          echo "BASE: ${{ env.NX_BASE }}"
          echo "HEAD: ${{ env.NX_HEAD }}"

      # ===========================================================================
      # OPTION 2) Step outputs (in this case we must give the step an "id")
      # ===========================================================================
      - name: Derive appropriate SHAs for base and head for `nx affected` commands
        id: setSHAs
        uses: nrwl/nx-set-shas@v1
    
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
<!-- end configuration-options -->