/**
 * Default filename patterns applied when no filenamePatterns are specified.
 * Excludes common package metadata files that are not meant to be extracted by consumers.
 */
export const DEFAULT_FILENAME_PATTERNS = [
  '**',
  '!package.json',
  '!bin/**',
  '!README.md',
  '!node_modules/**',
];

/**
 * Configuration for a post-extract symlink operation.
 * After files are extracted, matching files/dirs in the output directory are made
 * available as symlinks inside the target directory.
 */
export type SymlinkConfig = {
  /**
   * Glob pattern relative to the extraction outputDir. Every file or directory
   * whose relative path matches this pattern will be represented by a symlink in
   * the target directory.
   * Example: "**\/skills\/**" will find every entry under any "skills" directory.
   */
  source: string;

  /**
   * Directory where the symlinks will be created, relative to the output
   * directory. Supports relative paths (e.g. "../sibling-dir").
   * Example: "links/skills" creates symlinks at <outputDir>/links/skills
   */
  target: string;
};

/**
 * Configuration for a post-extract content-replacement operation.
 * After files are extracted, the specified files in the workspace are searched
 * for regex matches and the matched portions are replaced with the target string.
 */
export type ContentReplacementConfig = {
  /**
   * Glob pattern (relative to the working directory) selecting workspace files
   * whose content should be modified.
   * Example: "docs/**\/*.md"
   */
  files: string;

  /**
   * Regular-expression string used to locate the text to replace inside each
   * matched file.  All non-overlapping occurrences are replaced (global flag is
   * applied automatically).
   * Example: "<!-- version: .* -->"
   */
  match: string;

  /**
   * Replacement string (may contain regex back-references such as "$1").
   * Example: "<!-- version: 1.2.3 -->"
   */
  replace: string;
};

/**
 * Configuration for filtering which files to include/exclude
 */
export type FileFilterConfig = {
  /**
   * Glob patterns to match filenames (e.g., "*.md", "src/**\/*.ts")
   */
  filenamePatterns?: string[];

  /**
   * Regex patterns to match file contents (files must contain at least one match)
   */
  contentRegexes?: RegExp[];
};

/**
 * Event emitted by extract() as files are processed.
 */
export type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end'; packageName: string; packageVersion: string }
  | { type: 'file-added'; packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted'; packageName: string; file: string }
  | { type: 'file-skipped'; packageName: string; file: string };

/**
 * Configuration for the consumer
 */
export type ConsumerConfig = FileFilterConfig & {
  /**
   * Package specs to install from registry. Each entry is either a bare package name
   * ("my-pkg") or a name with a semver constraint ("my-pkg@^1.2.3"). Multiple packages
   * can be provided and they will all be extracted into outputDir.
   */
  packages: string[];

  /**
   * Output directory where files will be extracted
   */
  outputDir: string;

  /**
   * Package manager type (auto-detect if not specified)
   */
  packageManager?: 'pnpm' | 'yarn' | 'npm';

  /**
   * Allow creating conflicting files (default: false, will error)
   */
  force?: boolean;

  /**
   * When true, skip files that already exist in the output directory but create
   * them when they are absent.  Cannot be combined with force.
   */
  keepExisting?: boolean;

  /**
   * Working directory from which to run package manager install commands (e.g. pnpm add).
   * Defaults to process.cwd() if not specified.
   */
  cwd?: string;

  /**
   * Automatically create/update a .gitignore file alongside each .npmdata marker file,
   * adding the managed files and the .npmdata file itself to be ignored by git.
   * Defaults to true. Set to false to disable.
   */
  gitignore?: boolean;

  /**
   * When true, write files to disk without creating a .npmdata marker, without
   * updating .gitignore, and without making files read-only. Files written with
   * this flag are not tracked by npmdata and can be freely edited by the user.
   * When a destination file already exists it is left untouched and reported as
   * skipped. Takes precedence over force.
   */
  unmanaged?: boolean;

  /**
   * When true, simulate extraction without writing anything to disk.
   * The returned ConsumerResult reflects what would have changed.
   */
  dryRun?: boolean;

  /**
   * When true, force a fresh install of each package even if a satisfying version
   * is already installed. Useful to pick up the latest patch or minor release.
   */
  upgrade?: boolean;

  /**
   * Optional callback called for each file event during extraction.
   * Useful for progress reporting in scripts and build tools.
   */
  onProgress?: (event: ProgressEvent) => void;

  /**
   * Content-replacement operations that were applied to files after extraction.
   * When provided, check() will apply the same transformations to the package
   * source content before comparing hashes, so files modified by replacements
   * are not incorrectly reported as out of sync.
   */
  contentReplacements?: ContentReplacementConfig[];
};

/**
 * Metadata about managed files
 */
export type ManagedFileMetadata = {
  /**
   * Path to the managed file (relative to marker file directory)
   */
  path: string;

  /**
   * Package name that created this file
   */
  packageName: string;

  /**
   * Package version that created this file
   */
  packageVersion: string;

  /**
   * Whether the file was written replacing an existing unmanaged file (via force flag)
   */
  force?: boolean;
};

/**
 * Result of a consumer operation
 */
export type ConsumerResult = {
  added: string[];
  modified: string[];
  deleted: string[];
  skipped: string[];
  sourcePackages: Array<{
    name: string;
    version: string;
    changes: {
      added: string[];
      modified: string[];
      deleted: string[];
      skipped: string[];
    };
  }>;
};

/**
 * Result of a check operation
 */
export type CheckResult = {
  /**
   * Whether all files are in sync
   */
  ok: boolean;

  /**
   * Aggregated files that differ from source (across all packages)
   */
  differences: {
    /**
     * Files that are in the .npmdata marker but missing from the output directory
     */
    missing: string[];

    /**
     * Files whose contents differ from the package source
     */
    modified: string[];

    /**
     * Files that exist in the package but have not been extracted yet
     */
    extra: string[];
  };

  /**
   * Per-package breakdown of differences
   */
  sourcePackages: Array<{
    name: string;
    version: string;
    ok: boolean;
    differences: {
      missing: string[];
      modified: string[];
      extra: string[];
    };
  }>;
};

/**
 * Configuration for selecting which files to extract from a package.
 */
export type SelectorConfig = {
  /**
   * Glob patterns to filter which files are extracted (e.g. ["data/**", "*.json"]).
   * Defaults to all files when not set.
   */
  files?: string[];

  /**
   * Regex patterns (as strings) to filter files by content. Only files whose content
   * matches at least one pattern are extracted.
   */
  contentRegexes?: string[];
};

/**
 * Output configuration for an extraction entry: where and how to write extracted files.
 */
export type OutputConfig = {
  /**
   * Output directory where files will be extracted, relative to where the consumer
   * runs the command (e.g. "./data" or "src/generated").
   */
  path: string;

  /**
   * Allow overwriting existing unmanaged files (default: false).
   */
  force?: boolean;

  /**
   * When true, skip files that already exist in the output directory but create
   * them when they are absent.  Cannot be combined with force (default: false).
   */
  keepExisting?: boolean;

  /**
   * Create/update a .gitignore file alongside each .npmdata marker file (default: true).
   */
  gitignore?: boolean;

  /**
   * Write files without creating a .npmdata marker, updating .gitignore, or making
   * files read-only. Existing files are skipped rather than overwritten (default: false).
   */
  unmanaged?: boolean;

  /**
   * Simulate extraction without writing anything to disk (default: false).
   */
  dryRun?: boolean;

  /**
   * Post-extract symlink operations. After extraction, for each config the runner
   * resolves all files/directories inside outputDir that match the source glob and
   * creates a corresponding symlink inside the target directory. Stale symlinks
   * (pointing into outputDir but no longer matched) are removed automatically.
   */
  symlinks?: SymlinkConfig[];

  /**
   * Post-extract content-replacement operations. After extraction, for each config
   * the runner finds workspace files matching the files glob and applies the regex
   * replacement to their contents.
   */
  contentReplacements?: ContentReplacementConfig[];
};

/**
 * A single extraction entry defined in the publishable package.json "npmdata" array.
 * The runner iterates over these entries and calls extract() for each one.
 */
export type NpmdataExtractEntry = {
  /**
   * Package spec to install and extract from. Either a bare name ("my-pkg") or a
   * name with a semver constraint ("my-pkg@^1.2.3").
   */
  package: string;

  /**
   * Output configuration: where to extract files and how.
   */
  output: OutputConfig;

  /**
   * File selection configuration: which files to extract from the package.
   */
  selector?: SelectorConfig;

  /**
   * Force a fresh install of the package even when a satisfying version is already
   * installed (default: false).
   */
  upgrade?: boolean;

  /**
   * Suppress per-file output, printing only the final result line (default: false).
   */
  silent?: boolean;

  /**
   * Print detailed progress information for each file and step processed (default: false).
   */
  verbose?: boolean;

  /**
   * Presets used to group and selectively run entries. When the data package is invoked with
   * --presets, only entries whose presets list includes at least one of the requested presets are
   * processed. Entries with no presets are always skipped when a preset filter is active.
   */
  presets?: string[];
};

/**
 * Top-level config structure stored under the "npmdata" key in package.json
 * or in a .npmdatarc file.
 */
export type NpmdataConfig = {
  /**
   * The list of extraction entries to process.
   */
  sets: NpmdataExtractEntry[];

  /**
   * Shell command to run after a successful extract action.
   * The full argv (action + flags) used during extraction is appended as
   * arguments so the script can inspect or react to them.
   * Skipped during dry-run.
   * Example: "node scripts/myPostExtract.js"
   */
  postExtractScript?: string;
};

/**
 * Package.json for a publishable project
 */
export type PublishablePackageJson = {
  name: string;
  version: string;
  description?: string;
  main?: string;
  bin?: string;
  files?: string[];
  dependencies?: Record<string, string>;
  npmdata?: NpmdataConfig;
  [key: string]: unknown;
};
