/* eslint-disable functional/no-let */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-undefined */
/* eslint-disable no-restricted-syntax */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { NpmdataConfig, NpmdataExtractEntry } from './types';
import { parsePackageSpec, readCsvMarker, loadInstalledPackageNpmdataConfig } from './utils';

type PackageJson = {
  name: string;
  npmdata?: NpmdataConfig;
};

/**
 * Extract just the package name (without version specifier) from a package spec string.
 * Delegates to the shared parsePackageSpec utility.
 */
function parseEntryPackageName(spec: string): { name: string } {
  const { name } = parsePackageSpec(spec);
  return { name };
}

// ─── Cascade config resolution ─────────────────────────────────────────────────

/**
 * One level in the npmdata cascade chain, representing the combined selector and
 * output configuration contributed by a single installed package's npmdata config.
 *
 * Levels are ordered from the deepest dependency (farthest from the consumer) to
 * the immediate source package.  A consumer entry is then applied on top.
 */
export type CascadeLevel = {
  /** The package whose npmdata config contributed this level. */
  packageName: string;
  /**
   * Combined glob patterns from all sets in this package's npmdata config.
   * When undefined the package's config imposed no file filter at this level.
   */
  files?: string[];
  /**
   * Combined content-regex strings from all sets in this package's npmdata config.
   * When undefined the package's config imposed no content filter at this level.
   */
  contentRegexes?: string[];
  /** Output boolean flags merged from the package's sets (last-defined-wins within the set list). */
  force?: boolean;
  keepExisting?: boolean;
  gitignore?: boolean;
  unmanaged?: boolean;
  dryRun?: boolean;
};

/**
 * Recursively build a cascade chain by walking the npmdata configs of installed packages
 * starting from `packageName`.
 *
 * The chain is built depth-first (deepest dependency first):
 *   [D_level, C_level, B_level]
 * so that merging left-to-right gives precedence to shallower (closer) packages.
 *
 * Circular dependencies are broken by the `visited` set.
 *
 * @param packageName - The package whose npmdata config should be read.
 * @param cwd         - Working directory used to locate node_modules.
 * @param visited     - Set of already-visited package names (prevents cycles).
 */
export function buildCascadeChain(
  packageName: string,
  cwd: string,
  visited: Set<string> = new Set(),
): CascadeLevel[] {
  if (visited.has(packageName)) return [];
  // eslint-disable-next-line functional/immutable-data
  visited.add(packageName);

  const npmdataConfig = loadInstalledPackageNpmdataConfig(packageName, cwd);
  if (!npmdataConfig) return [];

  const chain: CascadeLevel[] = [];

  // Collect unique package names referenced in B's sets and recurse into them first
  // (depth-first, deepest dependency goes first in the chain).
  const seenDeps = new Set<string>();
  for (const set of npmdataConfig.sets) {
    const { name: depName } = parsePackageSpec(set.package);
    // Avoid recursing into self-referential entries or already-processed deps.
    if (depName !== packageName && !seenDeps.has(depName) && !visited.has(depName)) {
      seenDeps.add(depName);
      const depChain = buildCascadeChain(depName, cwd, new Set(visited));
      // eslint-disable-next-line functional/immutable-data
      chain.push(...depChain);
    }
  }

  // Build this package's combined level from all its sets.
  const allFiles = npmdataConfig.sets.flatMap((s) => s.selector?.files ?? []);
  const allContentRegexes = npmdataConfig.sets.flatMap((s) => s.selector?.contentRegexes ?? []);

  // For output booleans, iterate through all sets and last-defined-wins.
  let force: boolean | undefined;
  let keepExisting: boolean | undefined;
  let gitignore: boolean | undefined;
  let unmanaged: boolean | undefined;
  let dryRun: boolean | undefined;

  for (const set of npmdataConfig.sets) {
    // eslint-disable-next-line no-undefined
    if (set.output.force !== undefined) force = set.output.force;
    // eslint-disable-next-line no-undefined
    if (set.output.keepExisting !== undefined) keepExisting = set.output.keepExisting;
    // eslint-disable-next-line no-undefined
    if (set.output.gitignore !== undefined) gitignore = set.output.gitignore;
    // eslint-disable-next-line no-undefined
    if (set.output.unmanaged !== undefined) unmanaged = set.output.unmanaged;
    // eslint-disable-next-line no-undefined
    if (set.output.dryRun !== undefined) dryRun = set.output.dryRun;
  }

  // eslint-disable-next-line functional/immutable-data
  chain.push({
    packageName,
    files: allFiles.length > 0 ? allFiles : undefined,
    contentRegexes: allContentRegexes.length > 0 ? allContentRegexes : undefined,
    force,
    keepExisting,
    gitignore,
    unmanaged,
    dryRun,
  });

  return chain;
}

/**
 * Merge a cascade chain (built via buildCascadeChain) with a consumer entry and return:
 * - cascadeFileSets      – file pattern sets from the chain (deepest first), to be passed
 *                          as --cascade-files flags so the subprocess can apply AND-per-level
 *                          filtering.  A's own selector.files are NOT included here (they are
 *                          passed via the normal --files flag).
 * - cascadeContentRegexSets – analogous sets for content regexes.
 * - mergedOutput         – output config with chain booleans merged as defaults (A wins).
 *
 * The cascade chain is ordered [deepest, ..., shallowest], so merging left-to-right gives
 * precedence to shallower (closer) levels, with A's entry having the final say.
 */
export function mergeCascadeChainWithEntry(
  chain: CascadeLevel[],
  entry: NpmdataExtractEntry,
): {
  cascadeFileSets: string[][];
  cascadeContentRegexSets: string[][];
  mergedOutput: typeof entry.output;
} {
  // Collect non-empty file/content-regex sets from the chain.
  const cascadeFileSets = chain
    .filter((level) => level.files && level.files.length > 0)
    .map((level) => level.files as string[]);

  const cascadeContentRegexSets = chain
    .filter((level) => level.contentRegexes && level.contentRegexes.length > 0)
    .map((level) => level.contentRegexes as string[]);

  // Merge output booleans: iterate chain from deepest to shallowest so later entries override.
  let force: boolean | undefined;
  let keepExisting: boolean | undefined;
  let gitignore: boolean | undefined;
  let unmanaged: boolean | undefined;
  let dryRun: boolean | undefined;

  for (const level of chain) {
    // eslint-disable-next-line no-undefined
    if (level.force !== undefined) force = level.force;
    // eslint-disable-next-line no-undefined
    if (level.keepExisting !== undefined) keepExisting = level.keepExisting;
    // eslint-disable-next-line no-undefined
    if (level.gitignore !== undefined) gitignore = level.gitignore;
    // eslint-disable-next-line no-undefined
    if (level.unmanaged !== undefined) unmanaged = level.unmanaged;
    // eslint-disable-next-line no-undefined
    if (level.dryRun !== undefined) dryRun = level.dryRun;
  }

  // A's own entry.output has final precedence over the cascade defaults.
  const mergedOutput = {
    ...entry.output,
    force: entry.output.force !== undefined ? entry.output.force : force,
    keepExisting:
      entry.output.keepExisting !== undefined ? entry.output.keepExisting : keepExisting,
    gitignore: entry.output.gitignore !== undefined ? entry.output.gitignore : gitignore,
    unmanaged: entry.output.unmanaged !== undefined ? entry.output.unmanaged : unmanaged,
    dryRun: entry.output.dryRun !== undefined ? entry.output.dryRun : dryRun,
  };

  return { cascadeFileSets, cascadeContentRegexSets, mergedOutput };
}

function buildExtractCommand(
  cliPath: string,
  entry: NpmdataExtractEntry,
  cwd: string = process.cwd(),
  cascadeFileSets?: string[][],
  cascadeContentRegexSets?: string[][],
): string {
  const outputFlag = ` --output "${path.resolve(cwd, entry.output.path)}"`;
  const forceFlag = entry.output?.force ? ' --force' : '';
  const keepExistingFlag = entry.output?.keepExisting ? ' --keep-existing' : '';
  const gitignoreFlag = entry.output?.gitignore === false ? ' --no-gitignore' : '';
  const unmanagedFlag = entry.output?.unmanaged ? ' --unmanaged' : '';
  const silentFlag = entry.silent ? ' --silent' : '';
  const verboseFlag = entry.verbose ? ' --verbose' : '';
  const dryRunFlag = entry.output?.dryRun ? ' --dry-run' : '';
  const upgradeFlag = entry.upgrade ? ' --upgrade' : '';
  const filesFlag =
    entry.selector?.files && entry.selector.files.length > 0
      ? ` --files "${entry.selector.files.join(',')}"`
      : '';
  const contentRegexFlag =
    entry.selector?.contentRegexes && entry.selector.contentRegexes.length > 0
      ? ` --content-regex "${entry.selector.contentRegexes.join(',')}"`
      : '';
  const cascadeFilesFlags = (cascadeFileSets ?? [])
    .map((files) => ` --cascade-files "${files.join(',')}"`)
    .join('');
  const cascadeContentRegexFlags = (cascadeContentRegexSets ?? [])
    .map((regexes) => ` --cascade-content-regex "${regexes.join(',')}"`)
    .join('');
  return `node "${cliPath}" extract --packages "${entry.package}"${outputFlag}${forceFlag}${keepExistingFlag}${gitignoreFlag}${unmanagedFlag}${silentFlag}${verboseFlag}${dryRunFlag}${upgradeFlag}${filesFlag}${contentRegexFlag}${cascadeFilesFlags}${cascadeContentRegexFlags}`;
}

/**
 * Build a CLI command string that checks whether local files are in sync with the entry's package.
 */
export function buildCheckCommand(
  cliPath: string,
  entry: NpmdataExtractEntry,
  cwd: string = process.cwd(),
): string {
  const outputFlag = ` --output "${path.resolve(cwd, entry.output.path)}"`;
  const verboseFlag = entry.verbose ? ' --verbose' : '';
  const filesFlag =
    entry.selector?.files && entry.selector.files.length > 0
      ? ` --files "${entry.selector.files.join(',')}"`
      : '';
  const contentRegexFlag =
    entry.selector?.contentRegexes && entry.selector.contentRegexes.length > 0
      ? ` --content-regex "${entry.selector.contentRegexes.join(',')}"`
      : '';
  return `node "${cliPath}" check --packages "${entry.package}"${outputFlag}${verboseFlag}${filesFlag}${contentRegexFlag}`;
}

/**
 * Build a CLI command string that lists all managed files in the given output directory.
 */
export function buildListCommand(
  cliPath: string,
  outputDir: string,
  cwd: string = process.cwd(),
  verbose = false,
): string {
  const resolvedOutput = path.resolve(cwd, outputDir);
  const verboseFlag = verbose ? ' --verbose' : '';
  return `node "${cliPath}" list --output "${resolvedOutput}"${verboseFlag}`;
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
  const outputFlag = ` --output "${path.resolve(cwd, entry.output.path)}"`;
  // Propagate silent/dry-run/verbose settings from the entry if present.
  const silentFlag = entry.silent ? ' --silent' : '';
  const verboseFlag = entry.verbose ? ' --verbose' : '';
  const dryRunFlag = entry.output?.dryRun ? ' --dry-run' : '';
  return `node "${cliPath}" purge --packages "${name}"${outputFlag}${silentFlag}${verboseFlag}${dryRunFlag}`;
}

/**
 * Collects all unique presets that appear across the given npmdata entries, sorted alphabetically.
 */
export function collectAllPresets(entries: NpmdataExtractEntry[]): string[] {
  const presetSet = new Set<string>();
  for (const entry of entries) {
    if (entry.presets) {
      for (const preset of entry.presets) {
        presetSet.add(preset);
      }
    }
  }
  return Array.from(presetSet).sort();
}

/**
 * Prints a help message to stdout, listing the extract action, all options, and available presets.
 */
export function printHelp(packageName: string, availablePresets: string[]): void {
  const presetsLine =
    availablePresets.length > 0 ? availablePresets.join(', ') : '(none defined in package.json)';
  const examplePreset = availablePresets.length > 0 ? availablePresets[0] : 'my-preset';
  process.stdout.write(
    [
      `Usage: ${packageName} <action> [options]`,
      '',
      'Actions:',
      '  extract  Extract files from the source package(s) defined in package.json',
      '  check    Verify local files are in sync with the source package(s)',
      '  list     List all files managed by npmdata in the output directories',
      '  purge    Remove all managed files previously extracted',
      '',
      'Options:',
      '  --help              Show this help message',
      '  --output, -o <dir>  Base directory for resolving all outputDir paths (default: cwd)',
      '  --dry-run           Simulate changes without writing or deleting any files',
      '  --presets <preset1,preset2>  Limit to entries whose presets overlap (comma-separated)',
      '  --no-gitignore      Disable .gitignore management for every entry (overrides per-entry setting)',
      '  --unmanaged         Run every entry in unmanaged mode (overrides per-entry setting)',
      '  --verbose, -v       Print detailed progress information for each step',
      '',
      `Available presets: ${presetsLine}`,
      '',
      'Examples:',
      `  ${packageName} extract`,
      '    Extract files for all entries defined in package.json',
      '',
      `  ${packageName} extract --output <dir>`,
      '    Extract files, resolving all outputDir paths relative to <dir> instead of cwd',
      '',
      `  ${packageName} extract --dry-run`,
      '    Preview what would be extracted without writing any files',
      '',
      `  ${packageName} extract --presets ${examplePreset}`,
      `    Extract files only for entries tagged "${examplePreset}"`,
      '',
      `  ${packageName} check`,
      '    Check if local files are in sync with the source packages',
      '',
      `  ${packageName} list`,
      '    List all files managed by npmdata in the output directories',
      '',
      `  ${packageName} purge`,
      '    Remove all managed files from the output directories',
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
 * Returns true when --dry-run appears in the argv array.
 */
export function parseDryRunFromArgv(argv: string[]): boolean {
  return argv.includes('--dry-run');
}

/**
 * Returns true when --silent appears in the argv array.
 */
export function parseSilentFromArgv(argv: string[]): boolean {
  return argv.includes('--silent');
}

/**
 * Returns true when --verbose or -v appears in the argv array.
 */
export function parseVerboseFromArgv(argv: string[]): boolean {
  return argv.includes('--verbose') || argv.includes('-v');
}

/**
 * Returns true when --no-gitignore appears in the argv array.
 * When true, overrides the gitignore setting of every entry to false.
 */
export function parseNoGitignoreFromArgv(argv: string[]): boolean {
  return argv.includes('--no-gitignore');
}

/**
 * Returns true when --unmanaged appears in the argv array.
 * When true, overrides the unmanaged setting of every entry to true.
 */
export function parseUnmanagedFromArgv(argv: string[]): boolean {
  return argv.includes('--unmanaged');
}

/**
 * Parses --presets from an argv array and returns the list of requested presets (split by comma).
 * Returns an empty array when --presets is not present.
 */
export function parsePresetsFromArgv(argv: string[]): string[] {
  const idx = argv.indexOf('--presets');
  if (idx === -1 || idx + 1 >= argv.length) {
    return [];
  }
  return argv[idx + 1]
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Filter entries by requested presets. When no presets are requested all entries pass through.
 * When presets are requested only entries that share at least one preset with the requested list
 * are included.
 */
export function filterEntriesByPresets(
  entries: NpmdataExtractEntry[],
  requestedPresets: string[],
): NpmdataExtractEntry[] {
  if (requestedPresets.length === 0) {
    return entries;
  }
  return entries.filter(
    (entry) => entry.presets && entry.presets.some((t) => requestedPresets.includes(t)),
  );
}

// ─── Managed path helpers ──────────────────────────────────────────────────────

/**
 * From the flat list of managed file paths (relative to outputDir) recorded in
 * the .npmdata marker, derive every unique path that can be symlinked: each
 * file itself plus every intermediate ancestor directory.
 *
 * Example: 'skills/skill-a/README.md' yields
 *   'skills', 'skills/skill-a', 'skills/skill-a/README.md'
 */
function managedPathsWithAncestors(managedFiles: ReturnType<typeof readCsvMarker>): string[] {
  const paths = new Set<string>();
  for (const mf of managedFiles) {
    // eslint-disable-next-line functional/immutable-data
    paths.add(mf.path);
    const parts = mf.path.split('/');
    // Add each ancestor directory by accumulating path segments.
    parts.slice(0, -1).reduce((prefix, seg) => {
      const ancestor = prefix ? `${prefix}/${seg}` : seg;
      // eslint-disable-next-line functional/immutable-data
      paths.add(ancestor);
      return ancestor;
    }, '');
  }
  return Array.from(paths);
}

/**
 * Read the .npmdata marker from outputDir and return managed file metadata.
 * Returns an empty array when the marker does not exist.
 */
function readManagedFiles(outputDir: string): ReturnType<typeof readCsvMarker> {
  const markerPath = path.join(outputDir, '.npmdata');
  return fs.existsSync(markerPath) ? readCsvMarker(markerPath) : [];
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
  if (!entry.output?.symlinks || entry.output.symlinks.length === 0) return;

  const outputDir = path.resolve(cwd, entry.output.path);
  const allManagedPaths = managedPathsWithAncestors(readManagedFiles(outputDir));

  for (const cfg of entry.output.symlinks!) {
    const targetDir = path.resolve(outputDir, cfg.target);
    fs.mkdirSync(targetDir, { recursive: true });

    // Build desired symlink map from managed paths (files + ancestor dirs) matching the source pattern.
    const desired = new Map<string, string>();
    for (const relPath of allManagedPaths) {
      if (minimatch(relPath, cfg.source, { dot: true })) {
        const absMatch = path.join(outputDir, relPath);
        desired.set(path.basename(absMatch), absMatch);
      }
    }

    // Remove stale managed symlinks that are no longer in the desired set.
    const existing = collectManagedSymlinks(targetDir, outputDir);
    for (const [basename] of existing) {
      if (!desired.has(basename)) {
        const symlinkPath = path.join(targetDir, basename);
        fs.unlinkSync(symlinkPath);
        if (!entry.silent) {
          // eslint-disable-next-line no-console
          console.log(`D\t${path.relative(cwd, symlinkPath)}`);
        }
      }
    }

    // Create or update symlinks.
    for (const [basename, sourcePath] of desired) {
      const symlinkPath = path.join(targetDir, basename);
      const action = symlinkAction(symlinkPath, sourcePath, existing.has(basename));

      if (action === 'update') {
        fs.unlinkSync(symlinkPath);
        fs.symlinkSync(sourcePath, symlinkPath);
        if (!entry.silent) {
          // eslint-disable-next-line no-console
          console.log(`M\t${path.relative(cwd, symlinkPath)}`);
        }
      } else if (action === 'create') {
        fs.symlinkSync(sourcePath, symlinkPath);
        if (!entry.silent) {
          // eslint-disable-next-line no-console
          console.log(`A\t${path.relative(cwd, symlinkPath)}`);
        }
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
  if (!entry.output?.contentReplacements || entry.output.contentReplacements.length === 0) return;

  const outputDir = path.resolve(cwd, entry.output.path);
  const managedFiles = readManagedFiles(outputDir);

  for (const cfg of entry.output.contentReplacements) {
    const regex = new RegExp(cfg.match, 'gm');
    for (const mf of managedFiles) {
      if (minimatch(mf.path, cfg.files, { dot: true })) {
        const filePath = path.join(outputDir, mf.path);
        if (fs.existsSync(filePath)) {
          const original = fs.readFileSync(filePath, 'utf8');
          const updated = original.replace(regex, cfg.replace);
          if (updated !== original) {
            // Files extracted by npmdata are set to read-only (0o444).
            // Temporarily make the file writable, apply the replacement, then restore read-only.
            fs.chmodSync(filePath, 0o644);
            fs.writeFileSync(filePath, updated, 'utf8');
            fs.chmodSync(filePath, 0o444);
          }
        }
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
  if (!entry.output?.contentReplacements || entry.output.contentReplacements.length === 0)
    return [];

  const outputDir = path.resolve(cwd, entry.output.path);
  const managedFiles = readManagedFiles(outputDir);
  const outOfSync: string[] = [];

  for (const cfg of entry.output.contentReplacements) {
    const regex = new RegExp(cfg.match, 'gm');
    for (const mf of managedFiles) {
      if (minimatch(mf.path, cfg.files, { dot: true })) {
        const filePath = path.join(outputDir, mf.path);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          // A file is out of sync when applying the replacement would change it.
          const expected = content.replace(regex, cfg.replace);
          if (expected !== content) {
            // eslint-disable-next-line functional/immutable-data
            outOfSync.push(filePath);
          }
        }
      }
    }
  }

  return outOfSync;
}

// ─── Action handlers ───────────────────────────────────────────────────────────

/**
 * Run a shell command, capturing its stdout while inheriting stderr.
 * The captured stdout is immediately written to process.stdout so the caller
 * sees it in real time (well, after the child exits).  Returns the full
 * captured stdout string and the child's exit code.  Non-zero exit codes do
 * NOT throw; callers are responsible for checking exitCode.
 */
function runCommandCapture(command: string, cwd: string): { stdout: string; exitCode: number } {
  // eslint-disable-next-line functional/no-try-statements
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const stdout =
      (execSync(command, {
        encoding: 'utf8',
        cwd,
        stdio: ['inherit', 'pipe', 'inherit'],
      }) as string) ?? '';
    process.stdout.write(stdout);
    return { stdout, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; status?: number };
    const stdout = err.stdout ?? '';
    process.stdout.write(stdout);
    return { stdout, exitCode: err.status ?? 1 };
  }
}

// eslint-disable-next-line complexity
function runExtract(
  entries: NpmdataExtractEntry[],
  excludedEntries: NpmdataExtractEntry[],
  cliPath: string,
  runCwd: string,
  dryRunFromArgv: boolean,
  silentFromArgv: boolean,
  verboseFromArgv: boolean,
  noGitignoreFromArgv: boolean,
  unmanagedFromArgv: boolean,
): void {
  if (verboseFromArgv) {
    // eslint-disable-next-line no-console
    console.log(
      `[verbose] extract: processing ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${runCwd})`,
    );
  }
  // eslint-disable-next-line functional/no-let
  let totalAdded = 0;
  // eslint-disable-next-line functional/no-let
  let totalModified = 0;
  // eslint-disable-next-line functional/no-let
  let totalDeleted = 0;
  // eslint-disable-next-line functional/no-let
  let totalSkipped = 0;
  // eslint-disable-next-line functional/no-let
  let entryIndex = 0;
  for (const entry of entries) {
    const effectiveSilent = entry.silent || silentFromArgv;
    if (entryIndex > 0 && !effectiveSilent) {
      process.stdout.write('\n');
    }
    entryIndex += 1;

    // Resolve the cascade chain from the source package's npmdata config (and its deps).
    const { name: entryPackageName } = parseEntryPackageName(entry.package);
    const cascadeChain = buildCascadeChain(entryPackageName, runCwd);
    const { cascadeFileSets, cascadeContentRegexSets, mergedOutput } = mergeCascadeChainWithEntry(
      cascadeChain,
      entry,
    );

    if (verboseFromArgv && cascadeChain.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[verbose] extract: cascade chain for ${entry.package}: [${cascadeChain.map((l) => l.packageName).join(' -> ')}]`,
      );
    }

    const effectiveEntry: NpmdataExtractEntry = {
      ...entry,
      output: {
        ...mergedOutput,
        dryRun: mergedOutput?.dryRun || dryRunFromArgv,
        ...(noGitignoreFromArgv ? { gitignore: false } : {}),
        ...(unmanagedFromArgv ? { unmanaged: true } : {}),
      },
      silent: effectiveSilent,
      verbose: entry.verbose || verboseFromArgv,
    };
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(
        `[verbose] extract: entry package=${entry.package} outputDir=${entry.output.path}`,
      );
    }
    fs.mkdirSync(path.resolve(runCwd, entry.output.path), { recursive: true });
    const command = buildExtractCommand(
      cliPath,
      effectiveEntry,
      runCwd,
      cascadeFileSets,
      cascadeContentRegexSets,
    );
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(`[verbose] extract: running command: ${command}`);
    }
    const { stdout: extractStdout, exitCode: extractExitCode } = runCommandCapture(command, runCwd);
    if (extractExitCode !== 0) {
      throw Object.assign(new Error('extract failed'), { status: extractExitCode });
    }
    const extractMatch = extractStdout.match(
      /Extraction complete:\s*(\d+) added,\s*(\d+) modified,\s*(\d+) deleted,\s*(\d+) skipped/,
    );
    if (extractMatch) {
      totalAdded += Number.parseInt(extractMatch[1], 10);
      totalModified += Number.parseInt(extractMatch[2], 10);
      totalDeleted += Number.parseInt(extractMatch[3], 10);
      totalSkipped += Number.parseInt(extractMatch[4], 10);
    }
    if (!effectiveEntry.output?.dryRun) {
      if (verboseFromArgv) {
        // eslint-disable-next-line no-console
        console.log(`[verbose] extract: applying symlinks for ${entry.package}`);
      }
      applySymlinks(effectiveEntry, runCwd);
      if (verboseFromArgv) {
        // eslint-disable-next-line no-console
        console.log(`[verbose] extract: applying content replacements for ${entry.package}`);
      }
      applyContentReplacements(entry, runCwd);
    }
  }

  // When a tag filter is active, purge managed files from excluded entries so that
  // the output directory contains only files from the currently active tag group.
  // Suppress the "Purging managed files..." banner for these implicit purges.
  for (const entry of excludedEntries) {
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(`[verbose] extract: purging excluded entry ${entry.package} (tag filter active)`);
    }
    const effectiveEntry: NpmdataExtractEntry = {
      ...entry,
      output: {
        ...entry.output,
        dryRun: entry.output?.dryRun || dryRunFromArgv,
      },
      silent: true,
    };
    const command = buildPurgeCommand(cliPath, effectiveEntry, runCwd);
    execSync(command, { stdio: 'inherit', cwd: runCwd });
  }

  if (!silentFromArgv && entries.length > 1) {
    process.stdout.write(
      `\nTotal extracted: ${totalAdded} added, ${totalModified} modified, ${totalDeleted} deleted, ${totalSkipped} skipped${dryRunFromArgv ? ' (dry run)' : ''}\n`,
    );
  }
}

function runCheck(
  entries: NpmdataExtractEntry[],
  cliPath: string,
  runCwd: string,
  verboseFromArgv: boolean,
  unmanagedFromArgv: boolean,
): void {
  const managedEntries = entries.filter((entry) => {
    const isUnmanaged = entry.output?.unmanaged || unmanagedFromArgv;
    if (isUnmanaged && verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(
        `[verbose] check: skipping unmanaged entry package=${entry.package} outputDir=${entry.output.path}`,
      );
    }
    return !isUnmanaged;
  });
  if (verboseFromArgv) {
    // eslint-disable-next-line no-console
    console.log(
      `[verbose] check: verifying ${managedEntries.length} entr${managedEntries.length === 1 ? 'y' : 'ies'} (cwd: ${runCwd})`,
    );
  }
  // eslint-disable-next-line functional/no-let
  let outOfSyncFiles: string[] = [];
  // eslint-disable-next-line functional/no-let
  let checkIndex = 0;
  for (const entry of managedEntries) {
    if (checkIndex > 0) {
      process.stdout.write('\n');
    }
    checkIndex += 1;
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(
        `[verbose] check: checking package=${entry.package} outputDir=${entry.output.path}`,
      );
    }
    const effectiveEntry: NpmdataExtractEntry = {
      ...entry,
      verbose: entry.verbose || verboseFromArgv,
    };
    const command = buildCheckCommand(cliPath, effectiveEntry, runCwd);
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(`[verbose] check: running command: ${command}`);
    }
    const { exitCode: checkExitCode } = runCommandCapture(command, runCwd);
    if (checkExitCode !== 0) {
      throw Object.assign(new Error('check failed'), { status: checkExitCode });
    }
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(`[verbose] check: checking content replacements for ${entry.package}`);
    }
    const entryOutOfSync = checkContentReplacements(entry, runCwd);
    for (const f of entryOutOfSync) {
      process.stderr.write(`content-replacement out of sync: ${f}\n`);
    }
    // eslint-disable-next-line functional/immutable-data
    outOfSyncFiles = [...outOfSyncFiles, ...entryOutOfSync];
  }
  if (outOfSyncFiles.length > 0) {
    throw Object.assign(new Error('content-replacements out of sync'), { status: 1 });
  }
  if (managedEntries.length > 1) {
    process.stdout.write(`\nTotal checked: ${managedEntries.length} packages\n`);
  }
}

function runList(
  allEntries: NpmdataExtractEntry[],
  cliPath: string,
  runCwd: string,
  verboseFromArgv: boolean,
): void {
  // Collect unique resolved output dirs (tag filter not applied; list is informational).
  const seenDirs = new Set<string>();
  if (verboseFromArgv) {
    // eslint-disable-next-line no-console
    console.log(
      `[verbose] list: listing managed files across ${allEntries.length} entr${allEntries.length === 1 ? 'y' : 'ies'} (cwd: ${runCwd})`,
    );
  }
  for (const entry of allEntries) {
    const resolvedDir = path.resolve(runCwd, entry.output.path);
    if (!seenDirs.has(resolvedDir)) {
      seenDirs.add(resolvedDir);
      if (verboseFromArgv) {
        // eslint-disable-next-line no-console
        console.log(`[verbose] list: scanning directory ${resolvedDir}`);
      }
      const command = buildListCommand(cliPath, entry.output.path, runCwd, verboseFromArgv);
      execSync(command, { stdio: 'inherit', cwd: runCwd });
    }
  }
}

// eslint-disable-next-line complexity
function runPurge(
  entries: NpmdataExtractEntry[],
  cliPath: string,
  runCwd: string,
  dryRunFromArgv: boolean,
  silentFromArgv: boolean,
  verboseFromArgv: boolean,
): void {
  if (verboseFromArgv) {
    // eslint-disable-next-line no-console
    console.log(
      `[verbose] purge: processing ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${runCwd})`,
    );
  }
  // eslint-disable-next-line functional/no-let
  let totalDeleted = 0;
  // eslint-disable-next-line functional/no-let
  let purgeIndex = 0;
  for (const entry of entries) {
    const effectiveSilent = entry.silent || silentFromArgv;
    if (purgeIndex > 0 && !effectiveSilent) {
      process.stdout.write('\n');
    }
    purgeIndex += 1;
    const effectiveEntry: NpmdataExtractEntry = {
      ...entry,
      output: {
        ...entry.output,
        dryRun: entry.output?.dryRun || dryRunFromArgv,
      },
      silent: effectiveSilent,
      verbose: entry.verbose || verboseFromArgv,
    };
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(`[verbose] purge: entry package=${entry.package} outputDir=${entry.output.path}`);
    }
    const command = buildPurgeCommand(cliPath, effectiveEntry, runCwd);
    if (verboseFromArgv) {
      // eslint-disable-next-line no-console
      console.log(`[verbose] purge: running command: ${command}`);
    }
    const { stdout: purgeStdout, exitCode: purgeExitCode } = runCommandCapture(command, runCwd);
    if (purgeExitCode !== 0) {
      throw Object.assign(new Error('purge failed'), { status: purgeExitCode });
    }
    const purgeMatch = purgeStdout.match(/Purge complete:\s*(\d+) deleted/);
    if (purgeMatch) {
      totalDeleted += Number.parseInt(purgeMatch[1], 10);
    }
    if (!effectiveEntry.output?.dryRun) {
      if (verboseFromArgv) {
        // eslint-disable-next-line no-console
        console.log(`[verbose] purge: cleaning up symlinks for ${entry.package}`);
      }
      applySymlinks(effectiveEntry, runCwd);
    }
  }
  if (!silentFromArgv && entries.length > 1) {
    process.stdout.write(`\nTotal purged: ${totalDeleted}${dryRunFromArgv ? ' (dry run)' : ''}\n`);
  }
}

/**
 * Run a given action for a list of pre-loaded npmdata entries.
 * Parses common flags (--presets, --output, --dry-run, --silent, --verbose, --no-gitignore,
 * --unmanaged) from argv and delegates to the appropriate action handler.
 *
 * Called from the CLI when a cosmiconfig configuration file is found and --packages is not
 * provided, so the same runner logic used by embedded data-package runners is reused.
 *
 * @param allEntries - Array of NpmdataExtractEntry loaded from the configuration.
 * @param action     - One of 'extract', 'check', 'list', 'purge'.
 * @param argv       - Full process.argv (or equivalent); [0] and [1] are the node binary and
 *                     script path which are sliced off internally.
 * @param cliPath    - Absolute path to the npmdata CLI main.js that sub-processes will invoke.
 */
export function runEntries(
  allEntries: NpmdataExtractEntry[],
  action: string,
  argv: string[],
  cliPath: string,
  postExtractScript?: string,
): void {
  const userArgs = argv.slice(2);
  const requestedPresets = parsePresetsFromArgv(argv);
  const entries = filterEntriesByPresets(allEntries, requestedPresets);
  const excludedEntries =
    requestedPresets.length > 0 ? allEntries.filter((e) => !entries.includes(e)) : [];

  const parsedOutput = parseOutputFromArgv(userArgs);
  const runCwd = parsedOutput ? path.resolve(process.cwd(), parsedOutput) : process.cwd();
  const dryRunFromArgv = parseDryRunFromArgv(userArgs);
  const silentFromArgv = parseSilentFromArgv(userArgs);
  const verboseFromArgv = parseVerboseFromArgv(userArgs);
  const noGitignoreFromArgv = parseNoGitignoreFromArgv(userArgs);
  const unmanagedFromArgv = parseUnmanagedFromArgv(userArgs);

  if (verboseFromArgv) {
    // eslint-disable-next-line no-console
    console.log(`[verbose] runner: action=${action} entries=${entries.length} cwd=${runCwd}`);
  }

  // eslint-disable-next-line functional/no-try-statements
  try {
    if (action === 'extract') {
      runExtract(
        entries,
        excludedEntries,
        cliPath,
        runCwd,
        dryRunFromArgv,
        silentFromArgv,
        verboseFromArgv,
        noGitignoreFromArgv,
        unmanagedFromArgv,
      );
      runPostExtractScript(postExtractScript, userArgs, dryRunFromArgv, verboseFromArgv, runCwd);
    } else if (action === 'check') {
      runCheck(entries, cliPath, runCwd, verboseFromArgv, unmanagedFromArgv);
    } else if (action === 'list') {
      runList(allEntries, cliPath, runCwd, verboseFromArgv);
    } else if (action === 'purge') {
      runPurge(entries, cliPath, runCwd, dryRunFromArgv, silentFromArgv, verboseFromArgv);
    }
  } catch (error: unknown) {
    // The child process already printed the error via stdio:inherit.
    // Exit with the child's exit code to suppress the Node.js stack trace.
    const status = (error as { status?: number })?.status;
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(status ?? 1);
  }
}

/**
 * If a postExtractScript is defined in the npmdata config, run it with the same
 * user arguments that were passed to the extract action.
 * Skipped during dry-run. The script receives the full argv slice (action + flags)
 * as appended arguments so it can inspect or react to them.
 */
function runPostExtractScript(
  postExtractScript: string | undefined,
  userArgs: string[],
  dryRun: boolean,
  verbose: boolean,
  cwd: string,
): void {
  if (!postExtractScript || dryRun) return;
  if (verbose) {
    // eslint-disable-next-line no-console
    console.log('[verbose] runner: running npmdata:postExtract script');
  }
  const scriptArgs = userArgs.join(' ');
  const command = scriptArgs ? `${postExtractScript} ${scriptArgs}` : postExtractScript;
  execSync(command, { stdio: 'inherit', cwd });
}

/**
 * Runs extraction for each entry defined in the publishable package's package.json "npmdata" array.
 * Invokes the npmdata CLI once per entry so that all CLI output and error handling is preserved.
 * Called from the minimal generated bin script with its own __dirname as binDir.
 *
 * Pass --presets <preset1,preset2> to limit processing to entries whose presets overlap with the given list.
 */
export function run(binDir: string, argv: string[] = process.argv): void {
  const pkgJsonPath = path.join(binDir, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as PackageJson;

  const allEntries: NpmdataExtractEntry[] =
    pkg.npmdata?.sets && pkg.npmdata.sets.length > 0
      ? pkg.npmdata.sets
      : [{ package: pkg.name, output: { path: '.' } }];

  const userArgs = argv.slice(2);

  if (userArgs.includes('--help')) {
    printHelp(pkg.name, collectAllPresets(allEntries));
    return;
  }

  // Default to 'extract' when no action is provided or the first arg is a flag.
  const action = userArgs.length === 0 || userArgs[0].startsWith('-') ? 'extract' : userArgs[0];

  if (!['extract', 'check', 'list', 'purge'].includes(action)) {
    process.stderr.write(
      `Error: unknown action '${action}'. Use 'extract', 'check', 'list', or 'purge'.\n\n`,
    );
    printHelp(pkg.name, collectAllPresets(allEntries));
    return;
  }

  const requestedPresets = parsePresetsFromArgv(argv);
  const entries = filterEntriesByPresets(allEntries, requestedPresets);
  const excludedEntries =
    requestedPresets.length > 0 ? allEntries.filter((e) => !entries.includes(e)) : [];

  const cliPath = require.resolve('npmdata/dist/main.js', { paths: [binDir] });
  const parsedOutput = parseOutputFromArgv(userArgs);
  const runCwd = parsedOutput ? path.resolve(process.cwd(), parsedOutput) : process.cwd();
  const dryRunFromArgv = parseDryRunFromArgv(userArgs);
  const silentFromArgv = parseSilentFromArgv(userArgs);
  const verboseFromArgv = parseVerboseFromArgv(userArgs);
  const noGitignoreFromArgv = parseNoGitignoreFromArgv(userArgs);
  const unmanagedFromArgv = parseUnmanagedFromArgv(userArgs);

  if (verboseFromArgv) {
    // eslint-disable-next-line no-console
    console.log(`[verbose] runner: action=${action} entries=${entries.length} cwd=${runCwd}`);
  }

  // eslint-disable-next-line functional/no-try-statements
  try {
    if (action === 'extract') {
      runExtract(
        entries,
        excludedEntries,
        cliPath,
        runCwd,
        dryRunFromArgv,
        silentFromArgv,
        verboseFromArgv,
        noGitignoreFromArgv,
        unmanagedFromArgv,
      );
      runPostExtractScript(
        pkg.npmdata?.postExtractScript,
        userArgs,
        dryRunFromArgv,
        verboseFromArgv,
        runCwd,
      );
    } else if (action === 'check') {
      runCheck(entries, cliPath, runCwd, verboseFromArgv, unmanagedFromArgv);
    } else if (action === 'list') {
      runList(allEntries, cliPath, runCwd, verboseFromArgv);
    } else if (action === 'purge') {
      runPurge(entries, cliPath, runCwd, dryRunFromArgv, silentFromArgv, verboseFromArgv);
    }
  } catch (error: unknown) {
    // The child process already printed the error via stdio:inherit.
    // Exit with the child's exit code to suppress the Node.js stack trace.
    const status = (error as { status?: number })?.status;
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(status ?? 1);
  }
}
