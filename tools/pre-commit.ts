import { execSync } from 'node:child_process';
import { bgGreen, bold, red } from 'yoctocolors';

function printErrorAndExit(error) {
  console.log(error);
  console.log(`\n${red(bold(' Commit failed '))}\n`);
  process.exit(1);
}

console.log(`\n${bgGreen(bold(' Validating commit '))}\n`);
console.log(` > Checking the build`);
try {
  execSync(`npm run build`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: 'true' },
  });
  console.log(` ✔ Build successful`);
  const result = execSync(`git diff --name-only`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: 'true' },
  });
  const changedFiles = result.split('\n').filter((f) => f.startsWith('dist/'));
  if (changedFiles.length > 0) {
    console.log(` > Adding modified build files`);
    changedFiles.forEach((f) => {
      execSync(`git add ${f}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    });
    console.log(
      ` ✔ Commit expanded with ${changedFiles.length} changed file(s)`,
    );
  }

  execSync(`npm run format`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: 'true' },
  });
  console.log(` ✔ Formatted files`);

  console.log(`\n${bold(' Commit successful ')}\n`);
  process.exit(0);
} catch (error) {
  printErrorAndExit(error);
}
