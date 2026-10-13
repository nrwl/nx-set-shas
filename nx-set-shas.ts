import * as core from '@actions/core';
import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const {
  runId,
  repo: { repo, owner },
  eventName,
} = github.context;
process.env.GITHUB_TOKEN = core.getInput('gh-token');
const mainBranchName = core.getInput('main-branch-name');
const errorOnNoSuccessfulWorkflow = core.getBooleanInput('error-on-no-successful-workflow');
const lastSuccessfulEvent = core.getInput('last-successful-event');
const workingDirectory = core.getInput('working-directory');
const workflowId = core.getInput('workflow-id');
const fallbackSHA = core.getInput('fallback-sha');
const remote = core.getInput('remote');
const usePreviousMergeGroupCommit = core.getBooleanInput('use-previous-merge-group-commit');
const lookupStrategy = core.getInput('lookup-strategy') || 'list';
const maxCommitsInput = core.getInput('max-commits') || '100';
const defaultWorkingDirectory = '.';
const lookupStrategies = ['list', 'per-commit'];

let BASE_SHA: string;
(async () => {
  if (!lookupStrategies.includes(lookupStrategy)) {
    core.setFailed(
      `Invalid 'lookup-strategy' value '${lookupStrategy}'. Expected one of: ${lookupStrategies.join(', ')}`,
    );
    return;
  }
  const maxCommits = Number(maxCommitsInput);
  if (!Number.isInteger(maxCommits) || maxCommits < 1) {
    core.setFailed(`Invalid 'max-commits' value '${maxCommitsInput}'. Expected a positive integer`);
    return;
  }

  if (workingDirectory !== defaultWorkingDirectory) {
    if (existsSync(workingDirectory)) {
      process.chdir(workingDirectory);
    } else {
      process.stdout.write('\n');
      process.stdout.write(`WARNING: Working directory '${workingDirectory}' doesn't exist.\n`);
    }
  }

  const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  });
  let HEAD_SHA = headResult.stdout;

  if (
    ['pull_request', 'pull_request_target'].includes(eventName) &&
    !github.context.payload.pull_request.merged
  ) {
    // Both pull_request and pull_request_target events have the same payload structure
    // https://github.com/nrwl/nx-set-shas/issues/186
    const pullRequestEventName = 'pull_request';
    const baseResult = spawnSync(
      'git',
      ['merge-base', `${remote}/${github.context.payload[pullRequestEventName].base.ref}`, 'HEAD'],
      { encoding: 'utf-8' },
    );
    BASE_SHA = baseResult.stdout;
  } else if (eventName == 'merge_group' && usePreviousMergeGroupCommit) {
    const baseResult = spawnSync('git', ['rev-parse', 'HEAD^1'], {
      encoding: 'utf-8',
    });
    BASE_SHA = baseResult.stdout;
  } else {
    try {
      BASE_SHA = await findSuccessfulCommit(
        workflowId,
        runId,
        owner,
        repo,
        mainBranchName,
        lastSuccessfulEvent,
        lookupStrategy,
        maxCommits,
      );
    } catch (e) {
      core.setFailed(e.message);
      return;
    }

    if (!BASE_SHA) {
      if (errorOnNoSuccessfulWorkflow) {
        reportFailure(mainBranchName);
        return;
      } else {
        process.stdout.write('\n');
        process.stdout.write(
          `WARNING: Unable to find a successful workflow run on '${remote}/${mainBranchName}', or the latest successful workflow was connected to a commit which no longer exists on that branch (e.g. if that branch was rebased)\n`,
        );
        if (fallbackSHA) {
          BASE_SHA = fallbackSHA;
          process.stdout.write(`Using provided fallback SHA: ${fallbackSHA}\n`);
        } else {
          // Check if HEAD~1 exists, and if not, set BASE_SHA to the empty tree hash
          const LAST_COMMIT_CMD = `${remote}/${mainBranchName}~1`;

          const baseRes = spawnSync('git', ['rev-parse', LAST_COMMIT_CMD], {
            encoding: 'utf-8',
          });

          if (baseRes.status !== 0 || !baseRes.stdout) {
            const emptyTreeRes = spawnSync('git', ['hash-object', '-t', 'tree', '/dev/null'], {
              encoding: 'utf-8',
            });
            // 4b825dc642cb6eb9a060e54bf8d69288fbee4904 is the expected result of hashing the empty tree
            BASE_SHA = emptyTreeRes.stdout ?? `4b825dc642cb6eb9a060e54bf8d69288fbee4904`;
            process.stdout.write(
              `HEAD~1 does not exist. We are therefore defaulting to use the empty git tree hash as BASE.\n`,
            );
          } else {
            process.stdout.write(
              `We are therefore defaulting to use HEAD~1 on '${remote}/${mainBranchName}'\n`,
            );

            BASE_SHA = baseRes.stdout;
          }

          process.stdout.write('\n');
          process.stdout.write(
            `NOTE: You can instead make this a hard error by setting 'error-on-no-successful-workflow' on the action in your workflow.\n`,
          );
          process.stdout.write('\n');
        }
        core.setOutput('noPreviousBuild', 'true');
      }
    } else {
      process.stdout.write('\n');
      process.stdout.write(
        `Found the last successful workflow run on '${remote}/${mainBranchName}'\n`,
      );
      process.stdout.write(`Commit: ${BASE_SHA}\n`);
    }
  }

  BASE_SHA = stripNewLineEndings(BASE_SHA);
  HEAD_SHA = stripNewLineEndings(HEAD_SHA);

  // Log base and head SHAs used for nx affected
  process.stdout.write('\n');
  process.stdout.write('Base SHA');
  process.stdout.write(BASE_SHA);
  process.stdout.write('\n');
  process.stdout.write('Head SHA');
  process.stdout.write(HEAD_SHA);
  process.stdout.write('\n');

  // Optionally set the derived SHAs as NX_BASE and NX_HEAD environment variables for the current job
  if (core.getBooleanInput('set-environment-variables-for-job')) {
    core.exportVariable('NX_BASE', BASE_SHA);
    core.exportVariable('NX_HEAD', HEAD_SHA);
    process.stdout.write(
      'NX_BASE and NX_HEAD environment variables have been set for the current Job',
    );
  }

  core.setOutput('base', BASE_SHA);
  core.setOutput('head', HEAD_SHA);
})();

function reportFailure(branchName: string): void {
  core.setFailed(`
    Unable to find a successful workflow run on '${remote}/${branchName}'
    NOTE: You have set 'error-on-no-successful-workflow' on the action so this is a hard error.

    Is it possible that you have no runs currently on '${remote}/${branchName}'?
    - If yes, then you should run the workflow without this flag first.
    - If no, then you might have changed your git history and those commits no longer exist.`);
}

/**
 * Find last successful workflow run on the repo
 */
async function findSuccessfulCommit(
  workflow_id: string | undefined,
  run_id: number,
  owner: string,
  repo: string,
  branch: string,
  lastSuccessfulEvent: string,
  lookupStrategy: string,
  maxCommits: number,
): Promise<string | undefined> {
  const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
  if (!workflow_id) {
    workflow_id = await octokit
      .request(`GET /repos/${owner}/${repo}/actions/runs/${run_id}`, {
        owner,
        repo,
        branch,
        run_id,
      })
      .then(({ data: { workflow_id } }) => workflow_id);
    process.stdout.write('\n');
    process.stdout.write(`Workflow Id not provided. Using workflow '${workflow_id}'\n`);
  }
  // on some workflow runs we do not have branch property
  const branchFilter =
    lastSuccessfulEvent === 'push' || lastSuccessfulEvent === 'workflow_dispatch'
      ? branch
      : undefined;

  if (lookupStrategy === 'per-commit') {
    return await findSuccessfulCommitPerCommit(
      octokit,
      workflow_id,
      owner,
      repo,
      branchFilter,
      lastSuccessfulEvent,
      maxCommits,
    );
  }

  // fetch all workflow runs on a given repo/branch/workflow with push and success
  const shas = await octokit
    .request(`GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`, {
      owner,
      repo,
      branch: branchFilter,
      workflow_id,
      event: lastSuccessfulEvent,
      status: 'success',
    })
    .then(({ data: { workflow_runs } }) =>
      workflow_runs.map((run: { head_sha: any }) => run.head_sha),
    );

  return await findExistingCommit(octokit, branch, shas);
}

/**
 * Walk the first-parent history of the current commit (excluding the current commit itself)
 * and return the first commit that has a successful run of the given workflow and event.
 * Every candidate is an ancestor of HEAD by construction, so no branch membership check is needed.
 */
async function findSuccessfulCommitPerCommit(
  octokit: InstanceType<typeof GitHub>,
  workflow_id: string | number,
  owner: string,
  repo: string,
  branch: string | undefined,
  lastSuccessfulEvent: string,
  maxCommits: number,
): Promise<string | undefined> {
  const revListResult = spawnSync(
    'git',
    ['rev-list', '--first-parent', `--max-count=${maxCommits}`, 'HEAD~1'],
    { encoding: 'utf-8' },
  );
  if (revListResult.status !== 0) {
    process.stdout.write('\n');
    process.stdout.write(
      `WARNING: Unable to list the git history of HEAD~1. Make sure the repository is checked out with enough history (e.g. 'fetch-depth: 0').\n`,
    );
    return undefined;
  }
  const shas = revListResult.stdout.split('\n').filter(Boolean);

  for (const sha of shas) {
    const runs = await octokit
      .request(`GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`, {
        owner,
        repo,
        branch,
        workflow_id,
        event: lastSuccessfulEvent,
        head_sha: sha,
        per_page: 100,
      })
      .then(({ data: { workflow_runs } }) => workflow_runs);
    if (runs.some((run: { conclusion: string | null }) => run.conclusion === 'success')) {
      return sha;
    }
  }

  process.stdout.write('\n');
  process.stdout.write(
    `No successful '${lastSuccessfulEvent}' workflow run found for the last ${shas.length} commit(s) before HEAD. You can increase this limit with 'max-commits'.\n`,
  );
  return undefined;
}

/**
 * Get first existing commit
 */
async function findExistingCommit(
  octokit: InstanceType<typeof GitHub>,
  branchName: string,
  shas: string[],
): Promise<string | undefined> {
  for (const commitSha of shas) {
    if (await commitExists(octokit, branchName, commitSha)) {
      return commitSha;
    }
  }
  return undefined;
}

/**
 * Check if given commit is valid
 */
async function commitExists(
  octokit: InstanceType<typeof GitHub>,
  branchName: string,
  commitSha: string,
): Promise<boolean> {
  try {
    spawnSync('git', ['cat-file', '-e', commitSha], {
      stdio: ['pipe', 'pipe', null],
    });

    // Check the commit exists in general
    await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}', {
      owner,
      repo,
      commit_sha: commitSha,
    });

    // Check the commit exists on the expected main branch (it will not in the case of a rebased main branch)
    const commits = await octokit.request('GET /repos/{owner}/{repo}/commits', {
      owner,
      repo,
      sha: branchName,
      per_page: 100,
    });

    return commits.data.some((commit: { sha: string }) => commit.sha === commitSha);
  } catch {
    return false;
  }
}

/**
 * Strips LF line endings from given string
 */
function stripNewLineEndings(string: string): string {
  return string.replace('\n', '');
}
