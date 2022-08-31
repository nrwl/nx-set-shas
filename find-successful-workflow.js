const { Octokit } = require("@octokit/action");
const core = require("@actions/core");
const github = require('@actions/github');
const { execSync } = require('child_process');
const { existsSync } = require('fs');

const { runId, repo: { repo, owner }, eventName } = github.context;
const mainBranchName = core.getInput('main-branch-name');
const errorOnNoSuccessfulWorkflow = core.getInput('error-on-no-successful-workflow');
const lastSuccessfulEvent = core.getInput('last-successful-event');
const workingDirectory = core.getInput('working-directory');
const workflowId = core.getInput('workflow-id');
const defaultWorkingDirectory = '.';

let BASE_SHA;
(async () => {
  if (workingDirectory !== defaultWorkingDirectory) {
    if (existsSync(workingDirectory)) {
      process.chdir(workingDirectory);
    } else {
      core.warning('\n');
      core.warning(`WARNING: Working directory '${workingDirectory}' doesn't exist.\n`);
    }
  }

  const HEAD_SHA = execSync(`git rev-parse HEAD`, { encoding: 'utf-8' });

  if (eventName === 'pull_request') {
    BASE_SHA = execSync(`git merge-base origin/"${mainBranchName}" HEAD`, { encoding: 'utf-8' });
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
        core.warning('\n');
        core.warning(`WARNING: Unable to find a successful workflow run on 'origin/${mainBranchName}'\n`);
        core.warning(`We are therefore defaulting to use HEAD~1 on 'origin/${mainBranchName}'\n`);
        core.warning('\n');
        core.warning(`NOTE: You can instead make this a hard error by setting 'error-on-no-successful-workflow' on the action in your workflow.\n`);

        BASE_SHA = execSync(`git rev-parse HEAD~1`, { encoding: 'utf-8' });
        core.setOutput('noPreviousBuild', 'true');
      }
    } else {
      core.info('\n');
      core.info(`Found the last successful workflow run on 'origin/${mainBranchName}'\n`);
      core.info(`Commit: ${BASE_SHA}\n`);
    }
  }

  const stripNewLineEndings = sha => sha.replace('\n', '');
  core.setOutput('base', stripNewLineEndings(BASE_SHA));
  core.setOutput('head', stripNewLineEndings(HEAD_SHA));
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
    core.info('\n');
    core.info(`Workflow Id not provided. Using workflow '${workflow_id}'\n`);
  }
  // fetch all workflow runs on a given repo/branch/workflow with push and success
  const shas = await octokit.request(`GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`, {
    owner,
    repo,
    // on non-push workflow runs we do not have branch property
    branch: lastSuccessfulEvent !== 'push' ? undefined : branch,
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
    execSync(`git cat-file -e ${commitSha}`, { stdio: ['pipe', 'pipe', null] });
    return true;
  } catch {
    return false;
  }
}
