import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const actionPath = fileURLToPath(new URL('./dist/nx-set-shas.js', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses the nearest matching Git tag as the base', () => {
  const repository = createRepository();
  commit(repository, 'first');
  git(repository, ['tag', 'nx_successful_ci_run__old']);
  commit(repository, 'second');
  git(repository, ['tag', 'unrelated']);
  const expectedBase = commit(repository, 'third');
  git(repository, ['tag', '-a', 'nx_successful_ci_run__latest', '-m', 'successful run']);
  const expectedHead = commit(repository, 'head');

  const result = runAction(repository, {
    'tag-match-pattern': 'nx_successful_ci_run*',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Tag: nx_successful_ci_run__latest');
  expect(result.outputs.base).toBe(expectedBase);
  expect(result.outputs.head).toBe(expectedHead);
});

test('uses the configured fallback when no Git tag matches', () => {
  const repository = createRepository();
  const expectedBase = commit(repository, 'first');
  const expectedHead = commit(repository, 'head');

  const result = runAction(repository, {
    'error-on-no-successful-workflow': 'false',
    'fallback-sha': expectedBase,
    'tag-match-pattern': 'missing-*',
  });

  expect(result.status).toBe(0);
  expect(result.outputs.base).toBe(expectedBase);
  expect(result.outputs.head).toBe(expectedHead);
  expect(result.outputs.noPreviousBuild).toBe('true');
});

test('uses the HEAD parent when no Git tag matches', () => {
  const repository = createRepository();
  commit(repository, 'first');
  const mainHead = commit(repository, 'main head');
  git(repository, ['update-ref', 'refs/remotes/origin/main', mainHead]);
  const expectedBase = commit(repository, 'feature parent');
  const expectedHead = commit(repository, 'head');

  const result = runAction(repository, {
    'error-on-no-successful-workflow': 'false',
    'tag-match-pattern': 'missing-*',
  });

  expect(result.status).toBe(0);
  expect(result.outputs.base).toBe(expectedBase);
  expect(result.outputs.head).toBe(expectedHead);
});

test('uses the empty tree when no previous commit exists', () => {
  const repository = createRepository();
  const expectedHead = commit(repository, 'head');

  const result = runAction(repository, {
    'error-on-no-successful-workflow': 'false',
    'tag-match-pattern': 'missing-*',
  });

  expect(result.status).toBe(0);
  expect(result.outputs.base).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  expect(result.outputs.head).toBe(expectedHead);
});

test('fails when no Git tag matches and hard errors are enabled', () => {
  const repository = createRepository();
  commit(repository, 'head');

  const result = runAction(repository, {
    'tag-match-pattern': 'missing-*',
  });

  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    "Unable to find a Git tag reachable from HEAD using pattern 'missing-*'",
  );
});

test('fails when Git cannot inspect matching tags', () => {
  const repository = createRepository();
  commit(repository, 'head');
  git(repository, ['config', 'core.repositoryformatversion', '999']);

  const result = runAction(repository, {});

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('git tag failed:');
});

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'nx-set-shas-'));
  temporaryDirectories.push(repository);
  git(repository, ['init', '--initial-branch=main']);
  git(repository, ['config', 'user.name', 'Nx Set SHAs']);
  git(repository, ['config', 'user.email', 'nx-set-shas@example.com']);
  git(repository, ['config', 'commit.gpgSign', 'false']);
  git(repository, ['config', 'tag.gpgSign', 'false']);
  return repository;
}

function commit(repository: string, content: string): string {
  writeFileSync(join(repository, 'content.txt'), content);
  git(repository, ['add', 'content.txt']);
  git(repository, ['commit', '-m', content]);
  return git(repository, ['rev-parse', 'HEAD']);
}

function git(repository: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim();
}

function runAction(
  repository: string,
  inputs: Record<string, string>,
): { status: number | null; stdout: string; outputs: Record<string, string> } {
  const outputPath = join(repository, 'github-output');
  const environmentPath = join(repository, 'github-environment');
  const eventPath = join(repository, 'github-event.json');
  writeFileSync(outputPath, '');
  writeFileSync(environmentPath, '');
  writeFileSync(eventPath, '{}');

  const actionInputs = {
    'gh-token': '',
    'main-branch-name': 'main',
    remote: 'origin',
    'set-environment-variables-for-job': 'false',
    'error-on-no-successful-workflow': 'true',
    'fallback-sha': '',
    'last-successful-event': 'push',
    'working-directory': '.',
    'workflow-id': '',
    'use-previous-merge-group-commit': 'true',
    'use-git-tags': 'true',
    'tag-match-pattern': 'nx_successful_ci_run*',
    ...inputs,
  };
  const inputEnvironment = Object.fromEntries(
    Object.entries(actionInputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value]),
  );

  const result = spawnSync('node', [actionPath], {
    cwd: repository,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...inputEnvironment,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'nrwl/nx-set-shas',
      GITHUB_RUN_ID: '1',
      GITHUB_OUTPUT: outputPath,
      GITHUB_ENV: environmentPath,
    },
  });

  return {
    status: result.status,
    stdout: `${result.stdout}${result.stderr}`,
    outputs: parseOutputs(readFileSync(outputPath, 'utf-8')),
  };
}

function parseOutputs(contents: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([^<]+)<<(.+)$/);
    if (!match) {
      continue;
    }

    const [, name, delimiter] = match;
    const value: string[] = [];
    index += 1;
    while (index < lines.length && lines[index] !== delimiter) {
      value.push(lines[index]);
      index += 1;
    }
    outputs[name] = value.join('\n');
  }

  return outputs;
}
