/**
 * Configuration for filtering which files to include/exclude
 */
export interface FileFilterConfig {
  /**
   * Glob patterns to match filenames (e.g., "*.md", "src/**\/*.ts")
   */
  filenamePatterns?: string[];

  /**
   * Regex patterns to match file contents (files must contain at least one match)
   */
  contentRegexes?: RegExp[];
}

/**
 * Configuration for the consumer
 */
export interface ConsumerConfig extends FileFilterConfig {
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
   * Check mode: verify files without modifying
   */
  check?: boolean;

  /**
   * Allow creating conflicting files (default: false, will error)
   */
  allowConflicts?: boolean;

  /**
   * Working directory from which to run package manager install commands (e.g. pnpm add).
   * Defaults to process.cwd() if not specified.
   */
  cwd?: string;
}

/**
 * Metadata about managed files
 */
export interface ManagedFileMetadata {
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
}

/**
 * Contents of the .folder-publisher marker file
 */
export interface FolderPublisherMarker {
  /**
   * Version of the marker format
   */
  version: string;

  /**
   * Files managed in this directory (can be from multiple packages)
   */
  managedFiles: ManagedFileMetadata[];
}

/**
 * Result of a consumer operation
 */
export interface ConsumerResult {
  /**
   * Number of files created
   */
  created: number;

  /**
   * Number of files updated
   */
  updated: number;

  /**
   * Number of files deleted
   */
  deleted: number;

  /**
   * List of created/updated/deleted file paths
   */
  changes: {
    created: string[];
    updated: string[];
    deleted: string[];
  };

  /**
   * Package information
   */
  sourcePackage: {
    name: string;
    version: string;
  };
}

/**
 * Result of a check operation
 */
export interface CheckResult {
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
}

/**
 * Package.json for a publishable project
 */
export interface PublishablePackageJson {
  name: string;
  version: string;
  description?: string;
  main?: string;
  bin?: string;
  files?: string[];
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}
