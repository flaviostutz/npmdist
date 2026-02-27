/* eslint-disable functional/no-let */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Runs the npmdata CLI (extract or check) on behalf of a publishable package.
 * Called from the minimal generated bin script with its own __dirname as binDir.
 */
export function run(binDir: string): void {
  const pkgJsonPath = path.join(binDir, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as { name: string };

  const fpCliPath = require.resolve('npmdata/dist/main.js', {
    paths: [binDir],
  });

  const action = process.argv[2] ?? 'extract';
  if (action !== 'extract' && action !== 'check') {
    process.stderr.write(`Invalid action: "${action}". Must be "extract" or "check".\n`);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }

  // Parse --output / -o, --force, --files, --content-regex from argv
  let outputDir: string | undefined;
  let force = false;
  let gitignore = false;
  let files: string | undefined;
  let contentRegex: string | undefined;
  const extraArgs = process.argv.slice(3);
  for (let i = 0; i < extraArgs.length; i += 1) {
    if (extraArgs[i] === '--output' || extraArgs[i] === '-o') {
      outputDir = extraArgs[i + 1];
      i += 1;
    } else if (extraArgs[i] === '--force') {
      force = true;
    } else if (extraArgs[i] === '--gitignore') {
      gitignore = true;
    } else if (extraArgs[i] === '--files') {
      files = extraArgs[i + 1];
      i += 1;
    } else if (extraArgs[i] === '--content-regex') {
      contentRegex = extraArgs[i + 1];
      i += 1;
    }
  }

  const outputFlag = outputDir ? ` --output "${outputDir}"` : '';
  const forceFlag = force ? ' --force' : '';
  const gitignoreFlag = gitignore ? ' --gitignore' : '';
  const filesFlag = files ? ` --files "${files}"` : '';
  const contentRegexFlag = contentRegex ? ` --content-regex "${contentRegex}"` : '';
  const command = `node "${fpCliPath}" ${action} --package "${pkg.name}"${outputFlag}${forceFlag}${gitignoreFlag}${filesFlag}${contentRegexFlag}`;

  process.on('uncaughtException', () => {
    process.exit(3);
  });

  execSync(command, { stdio: 'inherit' });
}
