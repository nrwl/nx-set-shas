const { Octokit } = require("@octokit/action");
const core = require("@actions/core");
const { execSync } = require('child_process');

const branch = process.argv[2];
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const run_id = process.env.GITHUB_RUN_ID;

(async () => {
  try {
    const octokit = new Octokit();
    // retrieve workflow-id
    const workflow_id = await octokit.request(`GET /repos/${owner}/${repo}/actions/runs/${run_id}`, {
      owner,
      repo,
      branch,
      run_id
    }).then(({ data: { workflow_id } }) => workflow_id);
    // fetch all workflow runs on a given repo/branch/workflow with push and success
    const shas = await octokit.request(`GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`, {
      owner,
      repo,
      branch,
      workflow_id,
      event: 'push',
      status: 'success'
    }).then(({ data: { workflow_runs } }) => workflow_runs.map(run => run.head_sha));

    const sha = await findExistingCommit(shas);
    console.log(sha);
  } catch (e) {
    core.setFailed(e.message);
    process.exit(1);
  }
})();

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
