/* eslint-disable no-restricted-syntax */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { NpmdataExtractEntry } from './types';

type PackageJson = {
  name: string;
  npmdata?: NpmdataExtractEntry[];
};

function buildExtractCommand(cliPath: string, entry: NpmdataExtractEntry): string {
  const outputFlag = ` --output "${entry.outputDir}"`;
  const forceFlag = entry.force ? ' --force' : '';
  const gitignoreFlag = entry.gitignore ? ' --gitignore' : '';
  const silentFlag = entry.silent ? ' --silent' : '';
  const dryRunFlag = entry.dryRun ? ' --dry-run' : '';
  const upgradeFlag = entry.upgrade ? ' --upgrade' : '';
  const filesFlag =
    entry.files && entry.files.length > 0 ? ` --files "${entry.files.join(',')}"` : '';
  const contentRegexFlag =
    entry.contentRegexes && entry.contentRegexes.length > 0
      ? ` --content-regex "${entry.contentRegexes.join(',')}"`
      : '';
  return `node "${cliPath}" extract --packages "${entry.package}"${outputFlag}${forceFlag}${gitignoreFlag}${silentFlag}${dryRunFlag}${upgradeFlag}${filesFlag}${contentRegexFlag}`;
}

/**
 * Runs extraction for each entry defined in the publishable package's package.json "npmdata" array.
 * Invokes the npmdata CLI once per entry so that all CLI output and error handling is preserved.
 * Called from the minimal generated bin script with its own __dirname as binDir.
 */
export function run(binDir: string): void {
  const pkgJsonPath = path.join(binDir, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as PackageJson;

  const entries: NpmdataExtractEntry[] =
    pkg.npmdata && pkg.npmdata.length > 0 ? pkg.npmdata : [{ package: pkg.name, outputDir: '.' }];

  const cliPath = require.resolve('npmdata/dist/main.js', { paths: [binDir] });

  for (const entry of entries) {
    const command = buildExtractCommand(cliPath, entry);
    execSync(command, { stdio: 'inherit' });
  }
}
