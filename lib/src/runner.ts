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
  const gitignoreFlag = entry.gitignore === false ? ' --no-gitignore' : '';
  const unmanagedFlag = entry.unmanaged ? ' --unmanaged' : '';
  const silentFlag = entry.silent ? ' --silent' : '';
  const dryRunFlag = entry.dryRun ? ' --dry-run' : '';
  const upgradeFlag = entry.upgrade ? ' --upgrade' : '';
  const filesFlag =
    entry.files && entry.files.length > 0 ? ` --files "${entry.files.join(',')}"` : '';
  const contentRegexFlag =
    entry.contentRegexes && entry.contentRegexes.length > 0
      ? ` --content-regex "${entry.contentRegexes.join(',')}"`
      : '';
  return `node "${cliPath}" extract --packages "${entry.package}"${outputFlag}${forceFlag}${gitignoreFlag}${unmanagedFlag}${silentFlag}${dryRunFlag}${upgradeFlag}${filesFlag}${contentRegexFlag}`;
}

/**
 * Parses --tags from an argv array and returns the list of requested tags (split by comma).
 * Returns an empty array when --tags is not present.
 */
export function parseTagsFromArgv(argv: string[]): string[] {
  const idx = argv.indexOf('--tags');
  if (idx === -1 || idx + 1 >= argv.length) {
    return [];
  }
  return argv[idx + 1]
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Filter entries by requested tags. When no tags are requested all entries pass through.
 * When tags are requested only entries that share at least one tag with the requested list
 * are included.
 */
export function filterEntriesByTags(
  entries: NpmdataExtractEntry[],
  requestedTags: string[],
): NpmdataExtractEntry[] {
  if (requestedTags.length === 0) {
    return entries;
  }
  return entries.filter((entry) => entry.tags && entry.tags.some((t) => requestedTags.includes(t)));
}

/**
 * Runs extraction for each entry defined in the publishable package's package.json "npmdata" array.
 * Invokes the npmdata CLI once per entry so that all CLI output and error handling is preserved.
 * Called from the minimal generated bin script with its own __dirname as binDir.
 *
 * Pass --tags <tag1,tag2> to limit extraction to entries whose tags overlap with the given list.
 */
export function run(binDir: string, argv: string[] = process.argv): void {
  const pkgJsonPath = path.join(binDir, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as PackageJson;

  const allEntries: NpmdataExtractEntry[] =
    pkg.npmdata && pkg.npmdata.length > 0 ? pkg.npmdata : [{ package: pkg.name, outputDir: '.' }];

  const requestedTags = parseTagsFromArgv(argv);
  const entries = filterEntriesByTags(allEntries, requestedTags);

  const cliPath = require.resolve('npmdata/dist/main.js', { paths: [binDir] });

  for (const entry of entries) {
    const command = buildExtractCommand(cliPath, entry);
    execSync(command, { stdio: 'inherit' });
  }
}
