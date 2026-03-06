/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line import/order
import { cli } from './cli';

// eslint-disable-next-line import/order, import/first
import { extract, check, list, purge } from './consumer';
// eslint-disable-next-line import/order, import/first
import { initPublisher } from './publisher';
// eslint-disable-next-line import/order, import/first
import { runEntries } from './runner';
// eslint-disable-next-line import/order, import/first
import type { CheckResult } from './types';
// eslint-disable-next-line import/order, import/first
import { getInstalledPackageVersion } from './utils';

jest.mock('./consumer', () => ({
  extract: jest.fn(),
  check: jest.fn(),
  list: jest.fn(),
  purge: jest.fn(),
}));

jest.mock('./publisher', () => ({
  initPublisher: jest.fn(),
}));

jest.mock('./runner', () => ({
  ...jest.requireActual('./runner'),
  runEntries: jest.fn(),
}));

jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  getInstalledPackageVersion: jest.fn(),
}));

// Cosmiconfig mock – controlled per test via mockCosmicSearch
const mockCosmicSearch = jest.fn();
jest.mock('cosmiconfig', () => ({
  cosmiconfig: jest.fn(() => ({ search: mockCosmicSearch })),
}));

type MockedExtract = jest.MockedFunction<typeof extract>;
type MockedCheck = jest.MockedFunction<typeof check>;
type MockedList = jest.MockedFunction<typeof list>;
type MockedPurge = jest.MockedFunction<typeof purge>;
type MockedInitPublisher = jest.MockedFunction<typeof initPublisher>;
type MockedGetInstalledPackageVersion = jest.MockedFunction<typeof getInstalledPackageVersion>;
type MockedRunEntries = jest.MockedFunction<typeof runEntries>;

const mockExtract = extract as MockedExtract;
const mockCheck = check as MockedCheck;
const mockList = list as MockedList;
const mockPurge = purge as MockedPurge;
const mockInitPublisher = initPublisher as MockedInitPublisher;
const mockGetInstalledPackageVersion =
  getInstalledPackageVersion as MockedGetInstalledPackageVersion;
const mockRunEntries = runEntries as MockedRunEntries;

const defaultExtractResult = {
  added: [],
  modified: [],
  deleted: [],
  skipped: [],
  sourcePackages: [
    {
      name: 'my-pkg',
      version: '1.0.0',
      changes: { added: [], modified: [], deleted: [], skipped: [] },
    },
  ],
};

/** Build a minimal valid CheckResult mock. */
function makeCheckResult(
  ok: boolean,
  missing: string[] = [],
  modified: string[] = [],
  extra: string[] = [],
): CheckResult {
  return {
    ok,
    differences: { missing, modified, extra },
    sourcePackages: [
      {
        name: 'my-pkg',
        version: '1.0.0',
        ok,
        differences: { missing, modified, extra },
      },
    ],
  };
}

describe('CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    mockGetInstalledPackageVersion.mockReturnValue('1.0.0');
    // set default resolved value for purge so tests that don't configure it don't throw
    mockPurge.mockResolvedValue({
      added: [],
      modified: [],
      deleted: [],
      skipped: [],
      sourcePackages: [],
    });
    // default: no cosmiconfig result found
    // eslint-disable-next-line no-undefined, unicorn/no-useless-undefined
    mockCosmicSearch.mockResolvedValue(undefined);
    // delete ./output folder if it exists to ensure clean state for tests
    const outputPath = path.join(__dirname, 'output');
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should default to extract and return 1 when no args given (no packages)', async () => {
    const exitCode = await cli(['node', 'cli.js']);
    expect(exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('--packages option is required'),
    );
  });

  it('should default to extract action when no explicit action is passed', async () => {
    mockExtract.mockResolvedValue(defaultExtractResult);
    const exitCode = await cli(['node', 'cli.js', '--packages', 'my-pkg']);
    expect(exitCode).toBe(0);
    expect(mockExtract).toHaveBeenCalled();
    const config = mockExtract.mock.calls[0][0];
    expect(config.packages).toEqual(['my-pkg']);
  });

  it('should return 0 for --help flag', async () => {
    const exitCode = await cli(['node', 'cli.js', '--help']);
    expect(exitCode).toBe(0);
  });

  it('should return 0 for -h flag', async () => {
    const exitCode = await cli(['node', 'cli.js', '-h']);
    expect(exitCode).toBe(0);
  });

  it('should print version and return 0 for --version flag', async () => {
    const exitCode = await cli(['node', 'cli.js', '--version']);
    expect(exitCode).toBe(0);
    expect(console.log).toHaveBeenCalled();
  });

  it('should treat -v as verbose flag and default to extract (return 1, no packages)', async () => {
    // -v alone triggers verbose on default extract command; fails because --packages is missing
    const exitCode = await cli(['node', 'cli.js', '-v']);
    expect(exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('--packages option is required'),
    );
  });

  describe('init command', () => {
    it('should return 1 when --files flag is missing', async () => {
      const exitCode = await cli(['node', 'cli.js', 'init']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--files option is required'),
      );
    });

    it('should parse --files and call initPublisher on success', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Initialized successfully',
        publishedFiles: ['docs/**', 'src/**'],
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--files', 'docs/**,src/**']);

      expect(exitCode).toBe(0);
      expect(mockInitPublisher).toHaveBeenCalledWith(['docs/**', 'src/**'], {
        additionalPackages: [],
        gitignore: true,
      });
    });

    it('should parse --packages and pass additionalPackages to initPublisher', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Initialized successfully',
        publishedFiles: ['docs/**'],
        additionalPackages: ['shared-data@^1.0.0', 'other-pkg'],
      });

      const exitCode = await cli([
        'node',
        'cli.js',
        'init',
        '--files',
        'docs/**',
        '--packages',
        'shared-data@^1.0.0,other-pkg',
      ]);

      expect(exitCode).toBe(0);
      expect(mockInitPublisher).toHaveBeenCalledWith(['docs/**'], {
        additionalPackages: ['shared-data@^1.0.0', 'other-pkg'],
        gitignore: true,
      });
    });

    it('should return 0 when initPublisher succeeds with publishedFiles', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
        publishedFiles: ['docs/**'],
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--files', 'docs/**']);
      expect(exitCode).toBe(0);
    });

    it('should return 0 when initPublisher succeeds without publishedFiles', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--files', 'docs/**']);
      expect(exitCode).toBe(0);
    });

    it('should return 1 when initPublisher fails', async () => {
      mockInitPublisher.mockResolvedValue({
        success: false,
        message: 'Initialization failed: something went wrong',
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--files', 'nonexistent/**']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Initialization failed'));
    });

    it('should pass gitignore=false to initPublisher when --no-gitignore flag is set', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
        publishedFiles: ['docs/**'],
      });

      await cli(['node', 'cli.js', 'init', '--files', 'docs/**', '--no-gitignore']);

      expect(mockInitPublisher).toHaveBeenCalledWith(['docs/**'], {
        additionalPackages: [],
        gitignore: false,
      });
    });

    it('should pass unmanaged=true to initPublisher when --unmanaged flag is set', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
        publishedFiles: ['docs/**'],
      });

      await cli(['node', 'cli.js', 'init', '--files', 'docs/**', '--unmanaged']);

      expect(mockInitPublisher).toHaveBeenCalledWith(['docs/**'], {
        additionalPackages: [],
        gitignore: true,
        unmanaged: true,
      });
    });

    it('should print verbose logs when --verbose flag is set for init', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
        publishedFiles: ['docs/**'],
      });

      await cli([
        'node',
        'cli.js',
        'init',
        '--files',
        'docs/**',
        '--packages',
        'pkg-a,pkg-b',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] init: file patterns');
      expect(allLogs).toContain('[verbose] init: additional packages: pkg-a, pkg-b');
      expect(allLogs).toContain('[verbose] init: gitignore=');
      expect(allLogs).toContain('[verbose] init: configuration written successfully');
    });

    it('should print additionalPackages from result when present', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
        publishedFiles: ['docs/**'],
        additionalPackages: ['shared-data@^1.0.0', 'other-pkg'],
      });

      await cli(['node', 'cli.js', 'init', '--files', 'docs/**']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('Additional data source packages: shared-data@^1.0.0, other-pkg');
    });
  });

  describe('extract subcommand', () => {
    it('should call extract and return 0 on success', async () => {
      mockExtract.mockResolvedValue({
        added: ['file1.md', 'file2.md'],
        modified: ['file3.md'],
        deleted: ['old.md'],
        skipped: [],
        sourcePackages: [
          {
            name: 'my-pkg',
            version: '1.0.0',
            changes: {
              added: ['file1.md', 'file2.md'],
              modified: ['file3.md'],
              deleted: ['old.md'],
              skipped: [],
            },
          },
        ],
      });

      const exitCode = await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', '/output']);
      expect(exitCode).toBe(0);
      expect(mockExtract).toHaveBeenCalled();
    });

    it('should pass multiple comma-separated package specs to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg@^1.2.3,other-pkg@2.x',
        './output',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.packages).toEqual(['my-pkg@^1.2.3', 'other-pkg@2.x']);
    });

    it('should return 1 when --packages flag is missing for extract', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      const exitCode = await cli(['node', 'cli.js', 'extract']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--packages option is required'),
      );
    });

    it('should return 1 for unknown command', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      const exitCode = await cli(['node', 'cli.js', 'unknown-cmd']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("unknown command 'unknown-cmd'"),
      );
    });

    it('should pass --files flag patterns to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        './output',
        '--files',
        '**/*.md,**/*.ts',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.filenamePatterns).toContain('**/*.md');
      expect(config.filenamePatterns).toContain('**/*.ts');
    });

    it('should pass --force flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', './output', '--force']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.force).toBe(true);
    });

    it('should pass gitignore=true by default to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', './output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.gitignore).toBe(true);
    });

    it('should pass gitignore=false when --no-gitignore flag is set for extract', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        './output',
        '--no-gitignore',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.gitignore).toBe(false);
    });

    it('should pass unmanaged=true to extract config when --unmanaged flag is set', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', './output', '--unmanaged']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.unmanaged).toBe(true);
    });

    it('should default unmanaged to false in extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', './output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.unmanaged).toBe(false);
    });

    it('should pass version in package spec to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg@1.2.x', './output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.packages).toContain('my-pkg@1.2.x');
    });

    it('should pass --content-regex flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        './output',
        '--content-regex',
        'foo,bar',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.contentRegexes).toHaveLength(2);
    });

    it('should pass --output/-o flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', '-o', './custom-output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.outputDir).toContain('custom-output');
    });

    it('should pass undefined filenamePatterns to extract when --files not specified', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', './output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.filenamePatterns).toBeUndefined();
    });

    it('should log created, updated and deleted files with status symbols', async () => {
      // The new CLI emits file-level events via onProgress; we simulate them here.
      mockExtract.mockImplementation(async (config) => {
        config.onProgress?.({
          type: 'package-start',
          packageName: 'my-pkg',
          packageVersion: '1.0.0',
        });
        config.onProgress?.({ type: 'file-added', packageName: 'my-pkg', file: 'file1.md' });
        config.onProgress?.({ type: 'file-added', packageName: 'my-pkg', file: 'file2.md' });
        config.onProgress?.({ type: 'file-modified', packageName: 'my-pkg', file: 'file3.md' });
        config.onProgress?.({ type: 'file-deleted', packageName: 'my-pkg', file: 'old.md' });
        return {
          added: ['file1.md', 'file2.md'],
          modified: ['file3.md'],
          deleted: ['old.md'],
          skipped: [],
          sourcePackages: [
            {
              name: 'my-pkg',
              version: '1.0.0',
              changes: {
                added: ['file1.md', 'file2.md'],
                modified: ['file3.md'],
                deleted: ['old.md'],
                skipped: [],
              },
            },
          ],
        };
      });

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', './output']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('>> Package my-pkg@1.0.0');
      expect(allLogs).toContain('A\tfile1.md');
      expect(allLogs).toContain('A\tfile2.md');
      expect(allLogs).toContain('M\tfile3.md');
      expect(allLogs).toContain('D\told.md');
      // Package header must appear before the files
      expect(allLogs.indexOf('>> Package my-pkg@1.0.0')).toBeLessThan(
        allLogs.indexOf('A\tfile1.md'),
      );
    });

    it('should pass --dry-run flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--dry-run',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.dryRun).toBe(true);
    });

    it('should print (dry run) in summary when --dry-run is set', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--dry-run',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('dry run');
    });

    it('should pass --upgrade flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--upgrade',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.upgrade).toBe(true);
    });

    it('should pass onProgress callback to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg', '--output', './output']);

      const config = mockExtract.mock.calls[0][0];
      expect(typeof config.onProgress).toBe('function');
    });

    it('should warn when --output is not provided', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'extract', '--packages', 'my-pkg']);

      const infoLogs = (console.info as jest.Mock).mock.calls.flat().join('\n');
      expect(infoLogs).toContain('No --output specified');
    });

    it('should pass undefined onProgress to extract config when --silent is set', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--silent',
      ]);

      const config = mockExtract.mock.calls[0][0];
      expect(config.onProgress).toBeUndefined();
    });

    it('should suppress progress and info logs and only print result line when --silent is set', async () => {
      mockExtract.mockImplementation(async (config) => {
        config.onProgress?.({
          type: 'package-start',
          packageName: 'my-pkg',
          packageVersion: '1.0.0',
        });
        config.onProgress?.({ type: 'file-added', packageName: 'my-pkg', file: 'file1.md' });
        return {
          added: ['file1.md'],
          modified: [],
          deleted: [],
          skipped: [],
          sourcePackages: [
            {
              name: 'my-pkg',
              version: '1.0.0',
              changes: { added: ['file1.md'], modified: [], deleted: [], skipped: [] },
            },
          ],
        };
      });

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--silent',
      ]);

      const infoLogs = (console.info as jest.Mock).mock.calls.flat().join('\n');
      expect(infoLogs).not.toContain('Extracting');
      expect(infoLogs).not.toContain('No --output specified');

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).not.toContain('>> Package');
      expect(allLogs).not.toContain('file1.md');
      expect(allLogs).toContain('Extraction complete');
    });

    it('should return 1 when --force and --keep-existing are both set', async () => {
      const exitCode = await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--force',
        '--keep-existing',
      ]);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--force and --keep-existing cannot be used together'),
      );
    });

    it('should print verbose logs for extract command', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--verbose',
        '--files',
        '**/*.md',
        '--content-regex',
        'foo',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] extract:');
      expect(allLogs).toContain('file filter patterns: **/*.md');
      expect(allLogs).toContain('content regex filters: foo');
      expect(allLogs).toContain('installing/resolving packages');
      expect(allLogs).toContain('[verbose] extract: processing complete');
    });

    it('should log verbose events for file-skipped and package-end via onProgress', async () => {
      mockExtract.mockImplementation(async (config) => {
        config.onProgress?.({
          type: 'package-start',
          packageName: 'my-pkg',
          packageVersion: '1.0.0',
        });
        config.onProgress?.({ type: 'file-skipped', packageName: 'my-pkg', file: 'skip.md' });
        config.onProgress?.({
          type: 'package-end',
          packageName: 'my-pkg',
          packageVersion: '1.0.0',
        });
        return defaultExtractResult;
      });

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('skipped file: skip.md');
      expect(allLogs).toContain('finished processing package my-pkg@1.0.0');
    });

    it('should log verbose file-modified and file-deleted via onProgress', async () => {
      mockExtract.mockImplementation(async (config) => {
        config.onProgress?.({ type: 'file-modified', packageName: 'my-pkg', file: 'change.md' });
        config.onProgress?.({ type: 'file-deleted', packageName: 'my-pkg', file: 'gone.md' });
        return defaultExtractResult;
      });

      await cli([
        'node',
        'cli.js',
        'extract',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('modified file: change.md');
      expect(allLogs).toContain('deleted file: gone.md');
    });
  });

  describe('check subcommand', () => {
    it('should return 0 when check reports files in sync', async () => {
      mockCheck.mockResolvedValue(makeCheckResult(true));

      const exitCode = await cli(['node', 'cli.js', 'check', '--packages', 'my-pkg', './output']);
      expect(exitCode).toBe(0);
    });

    it('should return 2 when check finds missing files', async () => {
      mockCheck.mockResolvedValue(makeCheckResult(false, ['file1.md']));

      const exitCode = await cli(['node', 'cli.js', 'check', '--packages', 'my-pkg', './output']);
      expect(exitCode).toBe(2);
    });

    it('should return 2 and list differences when check finds modified files', async () => {
      mockCheck.mockResolvedValue(makeCheckResult(false, ['missing.md'], ['modified.md']));

      const exitCode = await cli(['node', 'cli.js', 'check', '--packages', 'my-pkg', './output']);
      expect(exitCode).toBe(2);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('missing.md');
      expect(allLogs).toContain('modified.md');
    });

    it('should return 2 and list extra files found by check', async () => {
      mockCheck.mockResolvedValue(makeCheckResult(false, [], [], ['new-in-pkg.md']));

      const exitCode = await cli(['node', 'cli.js', 'check', '--packages', 'my-pkg', './output']);
      expect(exitCode).toBe(2);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('new-in-pkg.md');
    });

    it('should return 1 when --packages flag is missing for check', async () => {
      const exitCode = await cli(['node', 'cli.js', 'check']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--packages option is required'),
      );
    });

    it('should pass --check flag in config', async () => {
      mockCheck.mockResolvedValue(makeCheckResult(true));

      await cli(['node', 'cli.js', 'check', '--packages', 'my-pkg', './output', '--check']);
      expect(mockCheck).toHaveBeenCalled();
    });

    it('should print verbose logs when --verbose is set and packages are in sync', async () => {
      mockCheck.mockResolvedValue(makeCheckResult(true));

      await cli([
        'node',
        'cli.js',
        'check',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] check: resolved output directory');
      expect(allLogs).toContain('[verbose] check: installing/resolving packages');
      expect(allLogs).toContain('[verbose] check: comparison complete');
      expect(allLogs).toContain('[verbose] check: package my-pkg@1.0.0 - all files match');
    });

    it('should print verbose logs when --verbose is set and packages are out of sync', async () => {
      mockCheck.mockResolvedValue(
        makeCheckResult(false, ['missing.md'], ['modified.md'], ['extra.md']),
      );

      await cli([
        'node',
        'cli.js',
        'check',
        '--packages',
        'my-pkg',
        '--output',
        './output',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain(
        '[verbose] check: package my-pkg@1.0.0 - missing=1 modified=1 extra=1',
      );
    });

    it('should print "s" suffix when multiple packages are checked in verbose mode', async () => {
      const result = {
        ok: true,
        differences: { missing: [], modified: [], extra: [] },
        sourcePackages: [
          {
            name: 'pkg-a',
            version: '1.0.0',
            ok: true,
            differences: { missing: [], modified: [], extra: [] },
          },
          {
            name: 'pkg-b',
            version: '2.0.0',
            ok: true,
            differences: { missing: [], modified: [], extra: [] },
          },
        ],
      };
      mockCheck.mockResolvedValue(result);

      await cli([
        'node',
        'cli.js',
        'check',
        '--packages',
        'pkg-a,pkg-b',
        '--output',
        './output',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('2 packages checked');
    });
  });

  describe('purge subcommand', () => {
    it('should call purge with correct packages and outputDir', async () => {
      mockPurge.mockResolvedValue({
        added: [],
        modified: [],
        deleted: ['docs/guide.md', 'data/file.json'],
        skipped: [],
        sourcePackages: [],
      });

      const exitCode = await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg',
        '--output',
        './data',
      ]);

      expect(exitCode).toBe(0);
      expect(mockPurge).toHaveBeenCalledWith(
        expect.objectContaining({
          packages: ['my-pkg'],
          outputDir: expect.stringContaining('data'),
        }),
      );
    });

    it('should return 1 and print error when --packages is missing', async () => {
      const exitCode = await cli(['node', 'cli.js', 'purge', '--output', './data']);
      expect(exitCode).toBe(1);
      expect(mockPurge).not.toHaveBeenCalled();
    });

    it('should pass dryRun: true when --dry-run is specified', async () => {
      mockPurge.mockResolvedValue({
        added: [],
        modified: [],
        deleted: ['docs/guide.md'],
        skipped: [],
        sourcePackages: [],
      });

      await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg',
        '--output',
        './data',
        '--dry-run',
      ]);

      expect(mockPurge).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });

    it('should pass comma-separated packages as array', async () => {
      await cli(['node', 'cli.js', 'purge', '--packages', 'pkg-a,pkg-b', '--output', './out']);

      expect(mockPurge).toHaveBeenCalledWith(
        expect.objectContaining({ packages: ['pkg-a', 'pkg-b'] }),
      );
    });

    it('should omit onProgress when --silent is specified', async () => {
      await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg',
        '--output',
        './out',
        '--silent',
      ]);

      const callArgs = mockPurge.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.onProgress).toBeUndefined();
    });

    it('should warn when --output is not provided', async () => {
      await cli(['node', 'cli.js', 'purge', '--packages', 'my-pkg']);

      const infoLogs = (console.info as jest.Mock).mock.calls.flat().join('\n');
      expect(infoLogs).toContain('No --output specified');
    });

    it('should print the number of deleted files in the summary', async () => {
      mockPurge.mockResolvedValue({
        added: [],
        modified: [],
        deleted: ['docs/a.md', 'docs/b.md'],
        skipped: [],
        sourcePackages: [],
      });

      await cli(['node', 'cli.js', 'purge', '--packages', 'my-pkg', '--output', './data']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('2 deleted');
    });

    it('should accept positional output directory argument for purge', async () => {
      await cli(['node', 'cli.js', 'purge', '--packages', 'my-pkg', './custom-dir']);

      expect(mockPurge).toHaveBeenCalledWith(
        expect.objectContaining({
          outputDir: expect.stringContaining('custom-dir'),
        }),
      );
    });

    it('should suppress the no-output warning when --silent is set for purge', async () => {
      await cli(['node', 'cli.js', 'purge', '--packages', 'my-pkg', '--silent']);

      const infoLogs = (console.info as jest.Mock).mock.calls.flat().join('\n');
      expect(infoLogs).not.toContain('No --output specified');
    });

    it('should print verbose logs when --verbose is set for purge', async () => {
      await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg,pkg-b',
        '--output',
        './data',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] purge: packages to remove: my-pkg, pkg-b');
      expect(allLogs).toContain('[verbose] purge: output directory');
      expect(allLogs).toContain('[verbose] purge: dryRun=false');
    });

    it('should print dry-run info message when --dry-run is set for purge', async () => {
      await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg',
        '--output',
        './data',
        '--dry-run',
      ]);

      const infoLogs = (console.info as jest.Mock).mock.calls.flat().join('\n');
      expect(infoLogs).toContain('Dry run: simulating purge');
    });

    it('should log package-start and file-deleted events via purge onProgress', async () => {
      mockPurge.mockImplementation(async (config) => {
        (config as Record<string, any>).onProgress?.({
          type: 'package-start',
          packageName: 'my-pkg',
        });
        (config as Record<string, any>).onProgress?.({
          type: 'file-deleted',
          packageName: 'my-pkg',
          file: 'docs/a.md',
        });
        return { added: [], modified: [], deleted: ['docs/a.md'], skipped: [], sourcePackages: [] };
      });

      await cli(['node', 'cli.js', 'purge', '--packages', 'my-pkg', '--output', './data']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('>> Package my-pkg');
      expect(allLogs).toContain('D\tdocs/a.md');
    });

    it('should log purge onProgress events with verbose details', async () => {
      mockPurge.mockImplementation(async (config) => {
        (config as Record<string, any>).onProgress?.({
          type: 'package-start',
          packageName: 'my-pkg',
        });
        (config as Record<string, any>).onProgress?.({
          type: 'file-deleted',
          packageName: 'my-pkg',
          file: 'docs/a.md',
        });
        return { added: [], modified: [], deleted: ['docs/a.md'], skipped: [], sourcePackages: [] };
      });

      await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg',
        '--output',
        './data',
        '--verbose',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] purge: starting removal of managed files for my-pkg');
      expect(allLogs).toContain('[verbose] purge: deleted file: docs/a.md');
    });

    it('should print (dry run) suffix when --dry-run is set in purge summary', async () => {
      mockPurge.mockResolvedValue({
        added: [],
        modified: [],
        deleted: ['docs/a.md'],
        skipped: [],
        sourcePackages: [],
      });

      await cli([
        'node',
        'cli.js',
        'purge',
        '--packages',
        'my-pkg',
        '--output',
        './data',
        '--dry-run',
      ]);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('dry run');
    });
  });

  describe('list subcommand', () => {
    it('should call list and print grouped results', async () => {
      mockList.mockReturnValue([
        { packageName: 'my-pkg', packageVersion: '1.0.0', files: ['docs/a.md', 'docs/b.md'] },
      ]);

      const exitCode = await cli(['node', 'cli.js', 'list', '--output', './data']);
      expect(exitCode).toBe(0);
      expect(mockList).toHaveBeenCalled();

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('my-pkg@1.0.0');
      expect(allLogs).toContain('docs/a.md');
      expect(allLogs).toContain('docs/b.md');
    });

    it('should print "No managed files found" when list returns empty', async () => {
      mockList.mockReturnValue([]);

      const exitCode = await cli(['node', 'cli.js', 'list', '--output', './data']);
      expect(exitCode).toBe(0);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('No managed files found');
    });

    it('should warn when --output is not provided for list', async () => {
      mockList.mockReturnValue([]);

      await cli(['node', 'cli.js', 'list']);

      const infoLogs = (console.info as jest.Mock).mock.calls.flat().join('\n');
      expect(infoLogs).toContain('Listing managed files in current directory');
    });

    it('should accept positional output directory argument for list', async () => {
      mockList.mockReturnValue([]);

      await cli(['node', 'cli.js', 'list', './custom-dir']);

      expect(mockList).toHaveBeenCalledWith(expect.stringContaining('custom-dir'));
    });

    it('should print verbose logs when --verbose is set for list with no entries', async () => {
      mockList.mockReturnValue([]);

      await cli(['node', 'cli.js', 'list', '--output', './data', '--verbose']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] list: resolved output directory');
      expect(allLogs).toContain('[verbose] list: scanning for .npmdata marker files');
      expect(allLogs).toContain('[verbose] list: found 0 managed package entries');
    });

    it('should print verbose logs per entry when --verbose is set for list', async () => {
      mockList.mockReturnValue([
        { packageName: 'my-pkg', packageVersion: '1.0.0', files: ['docs/a.md'] },
        {
          packageName: 'other-pkg',
          packageVersion: '2.0.0',
          files: ['data/b.json', 'data/c.json'],
        },
      ]);

      await cli(['node', 'cli.js', 'list', '--output', './data', '--verbose']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('[verbose] list: found 2 managed package entries');
      expect(allLogs).toContain('my-pkg@1.0.0 has 1 managed file');
      expect(allLogs).toContain('other-pkg@2.0.0 has 2 managed files');
    });
  });

  describe('config-file mode (cosmiconfig)', () => {
    const sampleEntries = [
      { package: 'my-data-pkg', outputDir: 'data' },
      { package: 'other-pkg', outputDir: 'docs' },
    ];

    it('extract without --packages uses cosmiconfig entries and returns 0', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: { sets: sampleEntries },
        filepath: '/project/package.json',
        isEmpty: false,
      });

      const exitCode = await cli(['node', 'cli.js', 'extract'], '/fake/main.js');

      expect(exitCode).toBe(0);
      expect(mockRunEntries).toHaveBeenCalledWith(
        sampleEntries,
        'extract',
        ['node', 'cli.js', 'extract'],
        '/fake/main.js',
      );
      expect(mockExtract).not.toHaveBeenCalled();
    });

    it('check without --packages uses cosmiconfig entries and returns 0', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: { sets: sampleEntries },
        filepath: '/project/.npmdatarc',
        isEmpty: false,
      });

      const exitCode = await cli(['node', 'cli.js', 'check'], '/fake/main.js');

      expect(exitCode).toBe(0);
      expect(mockRunEntries).toHaveBeenCalledWith(
        sampleEntries,
        'check',
        ['node', 'cli.js', 'check'],
        '/fake/main.js',
      );
      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('purge without --packages uses cosmiconfig entries and returns 0', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: { sets: sampleEntries },
        filepath: '/project/package.json',
        isEmpty: false,
      });

      const exitCode = await cli(['node', 'cli.js', 'purge'], '/fake/main.js');

      expect(exitCode).toBe(0);
      expect(mockRunEntries).toHaveBeenCalledWith(
        sampleEntries,
        'purge',
        ['node', 'cli.js', 'purge'],
        '/fake/main.js',
      );
      expect(mockPurge).not.toHaveBeenCalled();
    });

    it('extract without --packages falls back to error when no config found', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined, no-undefined
      mockCosmicSearch.mockResolvedValue(undefined);

      const exitCode = await cli(['node', 'cli.js', 'extract']);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--packages option is required'),
      );
      expect(mockRunEntries).not.toHaveBeenCalled();
    });

    it('check without --packages falls back to error when no config found', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined, no-undefined
      mockCosmicSearch.mockResolvedValue(undefined);

      const exitCode = await cli(['node', 'cli.js', 'check']);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--packages option is required'),
      );
    });

    it('purge without --packages falls back to error when no config found', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined, no-undefined
      mockCosmicSearch.mockResolvedValue(undefined);

      const exitCode = await cli(['node', 'cli.js', 'purge']);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--packages option is required'),
      );
    });

    it('extract without --packages falls back to error when config has empty sets', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: { sets: [] },
        filepath: '/project/package.json',
        isEmpty: false,
      });

      const exitCode = await cli(['node', 'cli.js', 'extract']);

      expect(exitCode).toBe(1);
      expect(mockRunEntries).not.toHaveBeenCalled();
    });

    it('extract without --packages falls back to error when config isEmpty flag is set', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: sampleEntries,
        filepath: '/project/package.json',
        isEmpty: true,
      });

      const exitCode = await cli(['node', 'cli.js', 'extract']);

      expect(exitCode).toBe(1);
      expect(mockRunEntries).not.toHaveBeenCalled();
    });

    it('config-file mode uses processArgs[1] as cliPath when none supplied', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: { sets: sampleEntries },
        filepath: '/project/package.json',
        isEmpty: false,
      });

      const exitCode = await cli(['node', '/path/to/main.js', 'extract']);

      expect(exitCode).toBe(0);
      expect(mockRunEntries).toHaveBeenCalledWith(
        sampleEntries,
        'extract',
        expect.any(Array),
        '/path/to/main.js',
      );
    });

    it('config-file mode passes CLI flags (--dry-run, --output) through argv to runEntries', async () => {
      mockCosmicSearch.mockResolvedValue({
        config: { sets: sampleEntries },
        filepath: '/project/package.json',
        isEmpty: false,
      });

      const argv = ['node', '/path/to/main.js', 'extract', '--dry-run', '--output', './out'];
      const exitCode = await cli(argv, '/fake/main.js');

      expect(exitCode).toBe(0);
      expect(mockRunEntries).toHaveBeenCalledWith(sampleEntries, 'extract', argv, '/fake/main.js');
    });
  });
});
