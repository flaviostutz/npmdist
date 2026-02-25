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
 * Configuration for the consumer
 */
export type ConsumerConfig = FileFilterConfig & {
  /**
   * Package name to install from registry
   */
  packageName: string;

  /**
   * Optional version constraint (semver pattern)
   */
  version?: string;

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
   * Working directory from which to run package manager install commands (e.g. pnpm add).
   * Defaults to process.cwd() if not specified.
   */
  cwd?: string;

  /**
   * Automatically create/update a .gitignore file alongside each .publisher marker file,
   * adding the managed files and the .publisher file itself to be ignored by git.
   */
  gitignore?: boolean;
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
  sourcePackage: {
    name: string;
    version: string;
  };
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
   * Files that differ from source
   */
  differences: {
    /**
     * Files that exist locally but not in package
     */
    missing: string[];

    /**
     * Files that exist in package but not locally
     */
    extra: string[];

    /**
     * Files whose contents differ
     */
    modified: string[];
  };

  /**
   * Package information
   */
  sourcePackage: {
    name: string;
    version: string;
  };
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
  [key: string]: unknown;
};
