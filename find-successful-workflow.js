const { Octokit } = require("@octokit/action");
const core = require("@actions/core");
const github = require('@actions/github');
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const parse = require('parse-link-header');

const { repo: { repo, owner }, eventName, ref, workflow } = github.context;
process.env.GITHUB_TOKEN = process.argv[2];
const mainBranchName = process.argv[3];
const errorOnNoSuccessfulWorkflow = process.argv[4];
const lastSuccessfulEvent = process.argv[5];
const workingDirectory = process.argv[6];
const workflowId = process.argv[7] || workflow;
const defaultWorkingDirectory = '.';
const refType = process.env.GITHUB_REF_TYPE;

process.stdout.write('\n');
process.stdout.write(`Starting..\n`)
process.stdout.write('\n');
process.stdout.write(`
  passed args to workflow:\n
  mainBranchName: ${mainBranchName}\n
  errorOnNoSuccessfulWorkflow: ${errorOnNoSuccessfulWorkflow}\n
  lastSuccessfulEvent: ${lastSuccessfulEvent}\n
  workingDirectory: ${workingDirectory}\n
  workflowId: ${workflowId}\n
  repo: ${repo}\n
  owner: ${owner}\n
  ref: ${ref}\n
  refType: ${refType}\n
  eventName: ${eventName}\n
`);

let BASE_SHA;
(async () => {
  if (workingDirectory !== defaultWorkingDirectory) {
    if (existsSync(workingDirectory)) {
      process.chdir(workingDirectory);
    } else {
      process.stdout.write('\n');
      process.stdout.write(`WARNING: Working directory '${workingDirectory}' doesn't exist.\n`);
    }
  }

  const HEAD_SHA = execSync(`git rev-parse HEAD`, { encoding: 'utf-8' });

  if (eventName === 'pull_request') {
    BASE_SHA = execSync(`git merge-base origin/${mainBranchName} HEAD`, { encoding: 'utf-8' });
  } else {
    try {
      // we only have a branch name on workflows of type "push" and refType "branch"
      BASE_SHA = await findSuccessfulCommit(isBranchPush() ? mainBranchName : null);
    } catch (e) {
      core.setFailed(e.message);
      return;
    }

    const refName = isBranchPush() ? "origin/" + mainBranchName : workflowId;
    if (BASE_SHA) {
      process.stdout.write('\n');
      process.stdout.write(`Found the last successful workflow run on ${refName}\n`);
      process.stdout.write(`Commit: ${BASE_SHA}\n`);
      return;
    }

    if (errorOnNoSuccessfulWorkflow === 'true') {
      reportFailure(mainBranchName);
      return;
    } else {
      process.stdout.write('\n');
      process.stdout.write(`WARNING: Unable to find a successful workflow run on ${refName}\n`);
      process.stdout.write(`We are therefore defaulting to use HEAD~1 on ${refName}\n`);
      process.stdout.write('\n');
      process.stdout.write(`NOTE: You can instead make this a hard error by setting 'error-on-no-successful-workflow' on the action in your workflow.\n`);

      BASE_SHA = execSync(`git rev-parse ${isBranchPush() ? "origin/" + mainBranchName : HEAD_SHA}~1`, { encoding: 'utf-8' });
      core.setOutput('noPreviousBuild', 'true');
      process.stdout.write('\n');
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
 * @param {string} branch
 * @returns
 */
async function findSuccessfulCommit(branch) {
  const octokit = new Octokit();
  // fetch all workflow runs on a given repo/branch/workflow with push and success
  process.stdout.write('\n');
  process.stdout.write(`Calling GH REST API for getting successful runs with owner ${owner}, repo ${repo}, branch ${branch}, workflowId ${workflowId} and event ${lastSuccessfulEvent}\n`);
  let shas = await octokit.request(`GET /repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`, {
    owner,
    repo,
    branch,
    workflowId,
    event: lastSuccessfulEvent,
    status: 'success'
  }).then(({ data: { workflow_runs } }) => workflow_runs.map(run => run.head_sha));

  process.stdout.write('\n');
  process.stdout.write(`Found ${shas.length} shas\n`);

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
      process.stdout.write('\n');
      process.stdout.write(`Found existing commit ${commitSha}\n`);
      return commitSha;
    }
  }

  process.stdout.write('\n');
  process.stdout.write(`No existing commit found\n`);

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
    process.stdout.write('\n');
    process.stdout.write(`commit ${commitSha} exits!\n`);
    return true;
  } catch {
    process.stdout.write('\n');
    process.stdout.write(`commit ${commitSha} does not exist!\n`);
    return false;
  }
}

/**
 * get oldest commit
 * @returns {string}
 */
async function getOldestCommitSha() {
  let commits = await octokit.request(`GET /repos/${owner}/${repo}/commits`, {
    per_page: 1,
  });
  const links = parse(commits.headers.link);
  commits = await octokit.request(`GET /repos/${owner}/${repo}/commits`, {
    per_page: links.last.per_page,
    page: links.last.page
  });
  commits = commits.data;
  const oldestCommit = commits[0];

  return oldestCommit.sha;
}

function isBranchPush(eventType, refType) {
  return (eventType === "push" && refType === "branch");
}
