/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line import/order
import { cli } from './cli';

// eslint-disable-next-line import/order, import/first
import { extract, check, list } from './consumer';
// eslint-disable-next-line import/order, import/first
import { initPublisher } from './publisher';
// eslint-disable-next-line import/order, import/first
import type { CheckResult } from './types';
// eslint-disable-next-line import/order, import/first
import { getInstalledPackageVersion } from './utils';

jest.mock('./consumer', () => ({
  extract: jest.fn(),
  check: jest.fn(),
  list: jest.fn(),
}));

jest.mock('./publisher', () => ({
  initPublisher: jest.fn(),
}));

jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  getInstalledPackageVersion: jest.fn(),
}));

type MockedExtract = jest.MockedFunction<typeof extract>;
type MockedCheck = jest.MockedFunction<typeof check>;
type MockedList = jest.MockedFunction<typeof list>;
type MockedInitPublisher = jest.MockedFunction<typeof initPublisher>;
type MockedGetInstalledPackageVersion = jest.MockedFunction<typeof getInstalledPackageVersion>;

const mockExtract = extract as MockedExtract;
const mockCheck = check as MockedCheck;
const mockList = list as MockedList;
const mockInitPublisher = initPublisher as MockedInitPublisher;
const mockGetInstalledPackageVersion =
  getInstalledPackageVersion as MockedGetInstalledPackageVersion;

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
    // delete ./output folder if it exists to ensure clean state for tests
    const outputPath = path.join(__dirname, 'output');
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should print usage and return 1 when no args given', async () => {
    const exitCode = await cli(['node', 'cli.js']);
    expect(exitCode).toBe(1);
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

  it('should print version and return 0 for -v flag', async () => {
    const exitCode = await cli(['node', 'cli.js', '-v']);
    expect(exitCode).toBe(0);
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
  });
});
