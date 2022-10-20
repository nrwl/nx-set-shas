const { Octokit } = require("@octokit/action");
const core = require("@actions/core");
const github = require('@actions/github');
const { execSync } = require('child_process');
const { existsSync } = require('fs');

const { runId, repo: { repo, owner }, eventName } = github.context;
process.env.GITHUB_TOKEN = process.argv[2];
const mainBranchName = process.argv[3];
const errorOnNoSuccessfulWorkflow = process.argv[4];
const lastSuccessfulEvent = process.argv[5];
const workingDirectory = process.argv[6];
// we cannot set userTag as process.argv[8] due to workflowId can be undefined, 
// then userTag will be taken as argv[7]
// so we have to take use-tag variable from core.getInput
const useTag = process.argv[7];
const workflowId = process.argv[8];
// const useTag = core.getInput('use-tag');
const defaultWorkingDirectory = '.';

let BASE_SHA;
let HEAD_SHA;

(async () => {
  if (workingDirectory !== defaultWorkingDirectory) {
    if (existsSync(workingDirectory)) {
      process.chdir(workingDirectory);
    } else {
      process.stdout.write('\n');
      process.stdout.write(`WARNING: Working directory '${workingDirectory}' doesn't exist.\n`);
    }
  }

  // in case use tag, we get latest tag's commit id to compare with latest success workflow commit id
  if (useTag === 'true') {
    HEAD_SHA = execSync(`git rev-parse ${mainBranchName}`, { encoding: 'utf-8' });
  } else {
    // otherwise, get HEAD
    HEAD_SHA = execSync(`git rev-parse HEAD`, { encoding: 'utf-8' });
  }

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
        process.stdout.write(`NOTE: You can instead make this a hard error by setting 'error-on-no-successful-workflow' on the action in your workflow.\n`);

        BASE_SHA = execSync(`git rev-parse ${mainBranchName}~1`, { encoding: 'utf-8' });
        core.setOutput('noPreviousBuild', 'true');
      }
    } else {
      process.stdout.write('\n');
      process.stdout.write(`Found the last successful workflow run on 'origin/${mainBranchName}'\n`);
      process.stdout.write(`Commit: ${BASE_SHA}\n`);
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
    process.stdout.write('\n');
    process.stdout.write(`Workflow Id not provided. Using workflow '${workflow_id}'\n`);
  }

  // tag don't have branch attached with it
  if(lastSuccessfulEvent !== 'push') { // useTag === 'true' || 
      branch = undefined
  }

  // during gitlab-ci for tag, branch does not required yet, unless you would check for special tag
  if (useTag === 'true' && lastSuccessfulEvent === 'push') {
    // branch = execSync(`git describe --abbrev=0 --tag ${branch}^`)
    branch = undefined
  }

  process.stdout.write(`owner: ${owner}\n`);
  process.stdout.write(`repo: ${repo}\n`);
  process.stdout.write(`useTag: ${useTag}\n`);
  process.stdout.write(`lastSuccessfulEvent: ${lastSuccessfulEvent}\n`);
  process.stdout.write(`branch: ${branch}\n`);

  // fetch all workflow runs on a given repo/branch/workflow with push and success
  const shas = await octokit.request(`GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`, {
    owner,
    repo,
    workflow_id,
    // on non-push workflow runs we do not have branch property
    branch: branch, // lastSuccessfulEvent !== 'push' ? undefined : branch
    // on tag, event always be 'push' and branch is always empty
    event: lastSuccessfulEvent,
    status: 'success'
  }).then(({ data: { workflow_runs } }) => workflow_runs.map(run => run.head_sha));

  process.stdout.write(`shas: ${shas}\n`);
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
