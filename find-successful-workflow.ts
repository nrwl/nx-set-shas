import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/action';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';

const {
  runId,
  repo: { repo, owner },
  eventName,
} = github.context;
process.env.GITHUB_TOKEN = process.argv[2];
const mainBranchName = process.argv[3];
const errorOnNoSuccessfulWorkflow = process.argv[4];
const lastSuccessfulEvent = process.argv[5];
const workingDirectory = process.argv[6];
const workflowId = process.argv[7];
const fallbackSHA = process.argv[8];
const defaultWorkingDirectory = '.';

const ProxifiedClient = Octokit.plugin(proxyPlugin);

let BASE_SHA: string;
let BASE_DEPLOY_SHA: string;
(async () => {
  if (workingDirectory !== defaultWorkingDirectory) {
    if (existsSync(workingDirectory)) {
      process.chdir(workingDirectory);
    } else {
      process.stdout.write('\n');
      process.stdout.write(
        `WARNING: Working directory '${workingDirectory}' doesn't exist.\n`,
      );
    }
  }

  const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  });
  const HEAD_SHA = headResult.stdout;

  if (
    ['pull_request', 'pull_request_target'].includes(eventName) &&
    !github.context.payload.pull_request.merged
  ) {
    const baseResult = spawnSync(
      'git',
      ['merge-base', `origin/${mainBranchName}`, 'HEAD'],
      { encoding: 'utf-8' },
    );
    BASE_SHA = baseResult.stdout;

    const ref = github.context.ref; // e.g., "refs/heads/main"
    const branch = ref.startsWith('refs/heads/')
      ? ref.replace('refs/heads/', '')
      : '';

    const deployResult = await findSuccessfulBranchDeployment(
      owner,
      repo,
      branch,
    );
    BASE_DEPLOY_SHA = deployResult;

    if (!deployResult) {
      const baseResult = spawnSync(
        'git',
        ['merge-base', `origin/${mainBranchName}`, `origin/${branch}`],
        { encoding: 'utf-8' },
      );

      BASE_DEPLOY_SHA = baseResult.stdout;
    }
  } else if (eventName == 'merge_group') {
    // merge queue get the last commit before yours and make that your base diff;
    // anything ahead that fails will fail your run so no need to run there stuff too.
    // TODO: Check for last failed run in main and make that the base for the HEAD of MQ
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
      );
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
        process.stdout.write(
          `WARNING: Unable to find a successful workflow run on 'origin/${mainBranchName}', or the latest successful workflow was connected to a commit which no longer exists on that branch (e.g. if that branch was rebased)\n`,
        );
        if (fallbackSHA) {
          BASE_SHA = fallbackSHA;
          process.stdout.write(`Using provided fallback SHA: ${fallbackSHA}\n`);
        } else {
          // Check if HEAD~1 exists, and if not, set BASE_SHA to the empty tree hash
          const LAST_COMMIT_CMD = `origin/${mainBranchName}~1`;

          const baseRes = spawnSync('git', ['rev-parse', LAST_COMMIT_CMD], {
            encoding: 'utf-8',
          });

          if (baseRes.status !== 0 || !baseRes.stdout) {
            const emptyTreeRes = spawnSync(
              'git',
              ['hash-object', '-t', 'tree', '/dev/null'],
              {
                encoding: 'utf-8',
              },
            );
            // 4b825dc642cb6eb9a060e54bf8d69288fbee4904 is the expected result of hashing the empty tree
            BASE_SHA =
              emptyTreeRes.stdout ?? `4b825dc642cb6eb9a060e54bf8d69288fbee4904`;
            process.stdout.write(
              `HEAD~1 does not exist. We are therefore defaulting to use the empty git tree hash as BASE.\n`,
            );
          } else {
            process.stdout.write(
              `We are therefore defaulting to use HEAD~1 on 'origin/${mainBranchName}'\n`,
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
        `Found the last successful workflow run on 'origin/${mainBranchName}'\n`,
      );
      process.stdout.write(`Commit: ${BASE_SHA}\n`);
    }
  }
  core.setOutput('base', stripNewLineEndings(BASE_SHA));
  core.setOutput('head', stripNewLineEndings(HEAD_SHA));
  core.setOutput('base-deploy', stripNewLineEndings(BASE_DEPLOY_SHA));
})();

function reportFailure(branchName: string): void {
  core.setFailed(`
    Unable to find a successful workflow run on 'origin/${branchName}'
    NOTE: You have set 'error-on-no-successful-workflow' on the action so this is a hard error.

    Is it possible that you have no runs currently on 'origin/${branchName}'?
    - If yes, then you should run the workflow without this flag first.
    - If no, then you might have changed your git history and those commits no longer exist.`);
}

function proxyPlugin(octokit: Octokit): void {
  octokit.hook.before('request', (options) => {
    const proxy: URL = getProxyForUrl(options.baseUrl);
    if (proxy) {
      options.request.agent = new HttpsProxyAgent(proxy);
    }
  });
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
): Promise<string | undefined> {
  const octokit = new ProxifiedClient();
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
    process.stdout.write(
      `Workflow Id not provided. Using workflow '${workflow_id}'\n`,
    );
  }
  // fetch all workflow runs on a given repo/branch/workflow with push and success
  const shas = await octokit
    .request(
      `GET /repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`,
      {
        owner,
        repo,
        // on some workflow runs we do not have branch property
        branch:
          lastSuccessfulEvent === 'push' ||
          lastSuccessfulEvent === 'workflow_dispatch'
            ? branch
            : undefined,
        workflow_id,
        event: lastSuccessfulEvent,
        status: 'success',
      },
    )
    .then(({ data: { workflow_runs } }) =>
      workflow_runs.map((run: { head_sha: any }) => run.head_sha),
    );

  return await findExistingCommit(octokit, branch, shas);
}

/**
 * Get first existing commit
 */
async function findExistingCommit(
  octokit: Octokit,
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
  octokit: Octokit,
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

    return commits.data.some(
      (commit: { sha: string }) => commit.sha === commitSha,
    );
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

/**
 * Find last successful deployment on the branch
 */
async function findSuccessfulBranchDeployment(
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const octokit = new ProxifiedClient();

  type DeploymentNode = {
    id: string;
    createdAt: string;
    environment: string;
    ref: { name: string };
    latestStatus: { state: string; createdAt: string } | null;
    commit: {
      oid: string; // Git SHA
      message: string; // Commit message
    } | null;
  };

  type GraphQLResponse = {
    repository: {
      deployments: {
        nodes: DeploymentNode[];
      };
    };
  };

  // GraphQL query to get deployments and their statuses
  const query = `
      query($owner: String!, $repo: String!, $branch: String!) {
        repository(owner: $owner, name: $repo) {
          deployments(last: 50, environments: ["production"], refName: $branch) {
            nodes {
              id
              createdAt
              environment
              ref {
                name
              }
              latestStatus {
                state
                createdAt
              }
              commit {
                oid
                message
              }
            }
          }
        }
      }
    `;

  // Execute the GraphQL query
  const response = await octokit.graphql<GraphQLResponse>(query, {
    owner,
    repo,
    branch: `refs/heads/${branch}`,
  });

  const deployments = response.repository.deployments.nodes;

  // Find the last successful deployment
  const successfulDeployment = deployments.find(
    (deployment) => deployment.latestStatus?.state === 'SUCCESS',
  );

  if (successfulDeployment) {
    core.info(`Found successful deployment for branch ${branch}:`);
    core.info(`ID: ${successfulDeployment.id}`);
    core.info(`Environment: ${successfulDeployment.environment}`);
    core.info(`Created at: ${successfulDeployment.createdAt}`);

    if (successfulDeployment.commit) {
      core.info(`Git SHA: ${successfulDeployment.commit.oid}`);
      core.info(`Commit Message: ${successfulDeployment.commit.message}`);
      return successfulDeployment.commit.oid;
    }
  } else {
    core.info(`No successful deployments found for branch: ${branch}`);
  }

  return undefined;
}
