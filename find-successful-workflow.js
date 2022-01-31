const { Octokit } = require("@octokit/action");
const core = require("@actions/core");
const github = require('@actions/github');
const { execSync } = require('child_process');

const { runId, repo: { repo, owner }, eventName } = github.context;
process.env.GITHUB_TOKEN = process.argv[2];
const mainBranchName = process.argv[3];
const errorOnNoSuccessfulWorkflow = process.argv[4];
const lastSuccessfulEvent = process.argv[5];
const workflowId = process.argv[6];

let BASE_SHA;
(async () => {
  const HEAD_SHA = execSync(`git rev-parse HEAD`, { encoding: 'utf-8' });

  if (eventName === 'pull_request') {
    BASE_SHA = execSync(`git merge-base origin/${mainBranchName} HEAD`, { encoding: 'utf-8' });
  } else {
    try {
      BASE_SHA = await findSuccessfulCommit(workflowId, runId, owner, repo, mainBranchName, lastSuccessfulEvent);
    } catch (e) {
      core.setFailed(e.message);
      return;
    }

    if (!BASE_SHA) {
      if (errorOnNoSuccessfulWorkflow === 'true') {
        reportFailure(mainBranchName);
        return;
      } else {
        process.stdout.write('\n');
        process.stdout.write(`WARNING: Unable to find a successful workflow run on 'origin/${mainBranchName}'\n`);
        process.stdout.write(`We are therefore defaulting to use HEAD~1 on 'origin/${mainBranchName}'\n`);
        process.stdout.write('\n');
        process.stdout.write(`NOTE: You can instead make this a hard error by settting 'error-on-no-successful-workflow' on the action in your workflow.\n`);

        BASE_SHA = execSync(`git rev-parse HEAD~1`, { encoding: 'utf-8' });
        core.setOutput('noPreviousBuild', 'true');
      }
    } else {
      process.stdout.write('\n');
      process.stdout.write(`Found the last successful workflow run on 'origin/${mainBranchName}'\n`);
      process.stdout.write(`Commit: ${BASE_SHA}\n`);
    }
  }
  core.setOutput('base', BASE_SHA);
  core.setOutput('head', HEAD_SHA);
})();

function reportFailure(branchName) {
  core.setFailed(`
    Unable to find a successful workflow run on 'origin/${branchName}'
    NOTE: You have set 'error-on-no-successful-workflow' on the action so this is a hard error.

    Is it possible that you have no runs currently on 'origin/${branchName}'?
    - If yes, then you should run the workflow without this flag first.
    - If no, then you might have changed your git history and those commits no longer exist.`);
}

/**
 * Find last successful workflow run on the repo
 * @param {string?} workflow_id
 * @param {number} run_id
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @returns
 */
async function findSuccessfulCommit(workflow_id, run_id, owner, repo, branch, lastSuccessfulEvent) {
  const octokit = new Octokit();
  if (!workflow_id) {
    workflow_id = await octokit.request(`GET /repos/${owner}/${repo}/actions/runs/${run_id}`, {
      owner,
      repo,
      branch,
      run_id
    }).then(({ data: { workflow_id } }) => workflow_id);
  }
  // fetch all workflow runs on a given repo/branch/workflow with push and success
  const shas = await octokit.request(`GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`, {
    owner,
    repo,
    branch,
    workflow_id,
    event: lastSuccessfulEvent,
    status: 'success'
  }).then(({ data: { workflow_runs } }) => workflow_runs.map(run => run.head_sha));

  return await findExistingCommit(shas);
}

/**
 * Get first existing commit
 * @param {string[]} commit_shas
 * @returns {string?}
 */
async function findExistingCommit(shas) {
  for (const commitSha of shas) {
    if (await commitExists(commitSha)) {
      return commitSha;
    }
  }
  return undefined;
}

/**
 * Check if given commit is valid
 * @param {string} commitSha
 * @returns {boolean}
 */
async function commitExists(commitSha) {
  try {
    execSync(`git cat-file -e ${commitSha} 2> /dev/null`);
    return true;
  } catch {
    return false;
  }
}
