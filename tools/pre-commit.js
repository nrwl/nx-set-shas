#!/usr/bin/env node

const chalk = require('chalk');
const { execSync } = require('child_process');

function printErrorAndExit(error) {
  console.log(error);
  console.log(`\n${chalk.red.bold(' Commit failed ')}\n`);
  process.exit(1);
}

console.log(`\n${chalk.bgGreen.bold(' Validating commit ')}\n`);
console.log(` > Checking the build`);
try {
  execSync(`npm run build`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FORCE_COLOR: 'true',
    },
  });
  console.log(` ✔ Build successful`);
  const result = execSync(`git diff --name-only`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    env: {
      ...process.env,
      FORCE_COLOR: 'true',
    },
  });
  const changedFiles = result.split('\n').filter((f) => f.startsWith('dist/'));
  if (changedFiles.length > 0) {
    console.log(` > Adding modified build files`);
    changedFiles.forEach((f) => {
      execSync(`git add ${f}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });
    console.log(
      ` ✔ Commit expanded with ${changedFiles.length} changed file(s)`,
    );
  }

  execSync(`npm run format`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FORCE_COLOR: 'true',
    },
  });
  console.log(` ✔ Formatted files`);

  console.log(`\n${chalk.bold(' Commit successful ')}\n`);
  process.exit(0);
} catch (error) {
  printErrorAndExit(error);
}
