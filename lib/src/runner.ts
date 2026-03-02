/* eslint-disable no-restricted-syntax */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { NpmdataExtractEntry } from './types';
import { parsePackageSpec } from './utils';

type PackageJson = {
  name: string;
  npmdata?: NpmdataExtractEntry[];
};

/**
 * Extract just the package name (without version specifier) from a package spec string.
 * Delegates to the shared parsePackageSpec utility.
 */
function parseEntryPackageName(spec: string): { name: string } {
  const { name } = parsePackageSpec(spec);
  return { name };
}

function buildExtractCommand(
  cliPath: string,
  entry: NpmdataExtractEntry,
  cwd: string = process.cwd(),
): string {
  const outputFlag = ` --output "${path.resolve(cwd, entry.outputDir)}"`;
  const forceFlag = entry.force ? ' --force' : '';
  const keepExistingFlag = entry.keepExisting ? ' --keep-existing' : '';
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
  return `node "${cliPath}" extract --packages "${entry.package}"${outputFlag}${forceFlag}${keepExistingFlag}${gitignoreFlag}${unmanagedFlag}${silentFlag}${dryRunFlag}${upgradeFlag}${filesFlag}${contentRegexFlag}`;
}

/**
 * Build a CLI command string that purges (removes) all managed files for the entry's package
 * from its output directory. No package installation is required.
 */
export function buildPurgeCommand(
  cliPath: string,
  entry: NpmdataExtractEntry,
  cwd: string = process.cwd(),
): string {
  const { name } = parseEntryPackageName(entry.package);
  const outputFlag = ` --output "${path.resolve(cwd, entry.outputDir)}"`;
  // Propagate silent/dry-run settings from the entry if present.
  const silentFlag = entry.silent ? ' --silent' : '';
  const dryRunFlag = entry.dryRun ? ' --dry-run' : '';
  return `node "${cliPath}" purge --packages "${name}"${outputFlag}${silentFlag}${dryRunFlag}`;
}

/**
 * Collects all unique tags that appear across the given npmdata entries, sorted alphabetically.
 */
export function collectAllTags(entries: NpmdataExtractEntry[]): string[] {
  const tagSet = new Set<string>();
  for (const entry of entries) {
    if (entry.tags) {
      for (const tag of entry.tags) {
        tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
}

/**
 * Prints a help message to stdout, listing the extract action, all options, and available tags.
 */
export function printHelp(packageName: string, availableTags: string[]): void {
  const tagsLine =
    availableTags.length > 0 ? availableTags.join(', ') : '(none defined in package.json)';
  const exampleTag = availableTags.length > 0 ? availableTags[0] : 'my-tag';
  process.stdout.write(
    [
      `Usage: ${packageName} <action> [options]`,
      '',
      'Actions:',
      '  extract  Extract files from the source package(s) defined in package.json',
      '',
      'Options:',
      '  --help              Show this help message',
      '  --output, -o <dir>  Base directory for resolving all outputDir paths (default: cwd)',
      '  --tags <tag1,tag2>  Limit extraction to entries whose tags overlap (comma-separated)',
      '',
      `Available tags: ${tagsLine}`,
      '',
      'Examples:',
      `  ${packageName} extract`,
      '    Extract files for all entries defined in package.json',
      '',
      `  ${packageName} extract --output <dir>`,
      '    Extract files, resolving all outputDir paths relative to <dir> instead of cwd',
      '',
      `  ${packageName} extract --tags ${exampleTag}`,
      `    Extract files only for entries tagged "${exampleTag}"`,
      '',
      `  ${packageName} extract --output <dir> --tags ${exampleTag}`,
      `    Combine --output and --tags`,
      '',
    ].join('\n'),
  );
}

/**
 * Parses --output (or -o) from an argv array and returns the path string.
 * Returns undefined when the flag is not present.
 */
export function parseOutputFromArgv(argv: string[]): string | undefined {
  const idx = argv.findIndex((a) => a === '--output' || a === '-o');
  if (idx === -1 || idx + 1 >= argv.length) {
    // eslint-disable-next-line no-undefined
    return undefined;
  }
  return argv[idx + 1];
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

// ─── Glob helpers ─────────────────────────────────────────────────────────────

/**
 * Walk a directory tree and return the absolute paths of every node (file or
 * directory) whose path relative to `rootDir` matches `pattern`.
 */
function globMatchInDir(rootDir: string, pattern: string): string[] {
  const results: string[] = [];

  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (minimatch(relPath, pattern, { dot: true })) {
        // eslint-disable-next-line functional/immutable-data
        results.push(fullPath);
      }
      // Always descend into directories so patterns like **/skills/** can match
      // entries deep in the tree even when the directory itself didn't match.
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      }
    }
  };

  walk(rootDir, '');
  return results;
}

/**
 * Walk a directory tree and return the absolute paths of files (not directories)
 * whose path relative to `rootDir` matches `pattern`.
 */
function globMatchFiles(rootDir: string, pattern: string): string[] {
  const results: string[] = [];

  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (minimatch(relPath, pattern, { dot: true })) {
        // eslint-disable-next-line functional/immutable-data
        results.push(fullPath);
      }
    }
  };

  walk(rootDir, '');
  return results;
}

/**
 * Collect all existing symlinks in `targetDir` whose resolved (or as-written)
 * link target starts with `outputDir`.  Returns a map of basename → resolved
 * target path.  Dead symlinks that still point into outputDir are included so
 * that they can be cleaned up.
 */
function collectManagedSymlinks(targetDir: string, outputDir: string): Map<string, string> {
  const owned = new Map<string, string>();
  if (!fs.existsSync(targetDir)) return owned;

  // Resolve outputDir through any intermediate symlinks (e.g. /var → /private/var on macOS)
  // so prefix comparisons work correctly on all platforms.
  // eslint-disable-next-line functional/no-let, functional/no-try-statements
  let resolvedOutputDir = outputDir;
  // eslint-disable-next-line functional/no-try-statements
  try {
    resolvedOutputDir = fs.realpathSync(outputDir);
  } catch {
    // If outputDir does not exist, fall back to the raw path.
  }

  const normalizedOutput = resolvedOutputDir.endsWith(path.sep)
    ? resolvedOutputDir
    : `${resolvedOutputDir}${path.sep}`;

  for (const name of fs.readdirSync(targetDir)) {
    const symlinkPath = path.join(targetDir, name);
    const lstat = fs.lstatSync(symlinkPath);
    if (lstat.isSymbolicLink()) {
      // Try to resolve (handles live symlinks).
      // eslint-disable-next-line functional/no-try-statements
      try {
        const resolved = fs.realpathSync(symlinkPath);
        if (resolved === resolvedOutputDir || resolved.startsWith(normalizedOutput)) {
          owned.set(name, resolved);
        }
      } catch {
        // Dead symlink – read the raw link target to see if it points into outputDir.
        const rawTarget = fs.readlinkSync(symlinkPath);
        const absTarget = path.resolve(targetDir, rawTarget);
        const resolvedAbsTarget = absTarget; // raw path is enough for dead-link check
        if (
          resolvedAbsTarget === outputDir ||
          resolvedAbsTarget.startsWith(`${outputDir}${path.sep}`)
        ) {
          owned.set(name, absTarget);
        }
      }
    }
  }
  return owned;
}

/**
 * Determine the symlink action for a single target path.
 * Returns 'create' when the path does not exist, 'update' when an out-of-date
 * managed symlink exists, or 'skip' when nothing should be done.
 */
function symlinkAction(
  symlinkPath: string,
  sourcePath: string,
  isManaged: boolean,
): 'create' | 'update' | 'skip' {
  // eslint-disable-next-line functional/no-try-statements
  try {
    const lstat = fs.lstatSync(symlinkPath);
    if (!lstat.isSymbolicLink()) return 'skip'; // Non-symlink – never clobber.
    if (!isManaged) return 'skip'; // Not managed by npmdata – leave alone.

    // Managed symlink: only recreate if the target has drifted.
    // eslint-disable-next-line functional/no-try-statements
    try {
      return fs.realpathSync(symlinkPath) === sourcePath ? 'skip' : 'update';
    } catch {
      return 'update'; // Dead link – recreate.
    }
  } catch {
    return 'create'; // Path does not exist.
  }
}

// ─── Post-extract operations ───────────────────────────────────────────────────

/**
 * Apply the symlink configs from an extraction entry.
 *
 * For each config:
 *  1. Expands the `source` glob inside the resolved `outputDir`.
 *  2. Ensures the `target` directory exists.
 *  3. Removes stale symlinks from the target dir that previously pointed into
 *     outputDir but are no longer matched by the current glob result.
 *  4. Creates (or updates) symlinks for every matched file/directory.
 *
 * Only symlinks whose targets live inside outputDir are managed; any other
 * symlinks in the target directory are left untouched.
 */
export function applySymlinks(entry: NpmdataExtractEntry, cwd: string = process.cwd()): void {
  if (!entry.symlinks || entry.symlinks.length === 0) return;

  const outputDir = path.resolve(cwd, entry.outputDir);

  for (const cfg of entry.symlinks) {
    const targetDir = path.resolve(cwd, cfg.target);
    fs.mkdirSync(targetDir, { recursive: true });

    // Build desired symlink map: basename (in target) → absolute source path.
    const desired = new Map<string, string>();
    for (const absMatch of globMatchInDir(outputDir, cfg.source)) {
      desired.set(path.basename(absMatch), absMatch);
    }

    // Remove stale managed symlinks that are no longer in the desired set.
    const existing = collectManagedSymlinks(targetDir, outputDir);
    for (const [basename] of existing) {
      if (!desired.has(basename)) {
        fs.unlinkSync(path.join(targetDir, basename));
      }
    }

    // Create or update symlinks.
    for (const [basename, sourcePath] of desired) {
      const symlinkPath = path.join(targetDir, basename);
      const action = symlinkAction(symlinkPath, sourcePath, existing.has(basename));

      if (action === 'update') {
        fs.unlinkSync(symlinkPath);
        fs.symlinkSync(sourcePath, symlinkPath);
      } else if (action === 'create') {
        fs.symlinkSync(sourcePath, symlinkPath);
      }
      // 'skip' → do nothing
    }
  }
}

/**
 * Apply the content-replacement configs from an extraction entry.
 *
 * For each config:
 *  1. Expands the `files` glob inside `cwd`.
 *  2. Reads each matched file.
 *  3. Applies the regex replacement (global, multiline).
 *  4. Writes the file back only when the content changed.
 */
export function applyContentReplacements(
  entry: NpmdataExtractEntry,
  cwd: string = process.cwd(),
): void {
  if (!entry.contentReplacements || entry.contentReplacements.length === 0) return;

  for (const cfg of entry.contentReplacements) {
    const regex = new RegExp(cfg.match, 'gm');
    for (const filePath of globMatchFiles(cwd, cfg.files)) {
      const original = fs.readFileSync(filePath, 'utf8');
      const updated = original.replace(regex, cfg.replace);
      if (updated !== original) {
        fs.writeFileSync(filePath, updated, 'utf8');
      }
    }
  }
}

/**
 * Check whether the content-replacement configs from an extraction entry are
 * currently in effect in the workspace.
 *
 * Returns a list of file paths where the replacement pattern still matches
 * (i.e. the replacement has not been applied or has drifted).  An empty list
 * means everything is in sync.
 */
export function checkContentReplacements(
  entry: NpmdataExtractEntry,
  cwd: string = process.cwd(),
): string[] {
  if (!entry.contentReplacements || entry.contentReplacements.length === 0) return [];

  const outOfSync: string[] = [];

  for (const cfg of entry.contentReplacements) {
    const regex = new RegExp(cfg.match, 'gm');
    for (const filePath of globMatchFiles(cwd, cfg.files)) {
      const content = fs.readFileSync(filePath, 'utf8');
      // A file is out of sync when applying the replacement would change it.
      const expected = content.replace(regex, cfg.replace);
      if (expected !== content) {
        // eslint-disable-next-line functional/immutable-data
        outOfSync.push(filePath);
      }
    }
  }

  return outOfSync;
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

  const userArgs = argv.slice(2);

  if (userArgs.length === 0 || userArgs.includes('--help')) {
    printHelp(pkg.name, collectAllTags(allEntries));
    return;
  }

  const action = userArgs[0];

  if (action !== 'extract') {
    process.stderr.write(`Error: unknown action '${action}'. Use 'extract'.\n\n`);
    printHelp(pkg.name, collectAllTags(allEntries));
    return;
  }

  const requestedTags = parseTagsFromArgv(argv);
  const entries = filterEntriesByTags(allEntries, requestedTags);
  const excludedEntries =
    requestedTags.length > 0 ? allEntries.filter((e) => !entries.includes(e)) : [];

  const cliPath = require.resolve('npmdata/dist/main.js', { paths: [binDir] });
  const parsedOutput = parseOutputFromArgv(userArgs);
  const runCwd = parsedOutput ? path.resolve(process.cwd(), parsedOutput) : process.cwd();

  for (const entry of entries) {
    const command = buildExtractCommand(cliPath, entry, runCwd);
    execSync(command, { stdio: 'inherit', cwd: runCwd });
    applySymlinks(entry, runCwd);
    applyContentReplacements(entry, runCwd);
  }

  // When a tag filter is active, purge managed files from excluded entries so that
  // the output directory contains only files from the currently active tag group.
  for (const entry of excludedEntries) {
    const command = buildPurgeCommand(cliPath, entry, runCwd);
    execSync(command, { stdio: 'inherit', cwd: runCwd });
  }
}
