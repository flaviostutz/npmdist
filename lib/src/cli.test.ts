/* eslint-disable no-console */
// eslint-disable-next-line import/order
import { cli } from './cli';

jest.mock('./consumer', () => ({
  extract: jest.fn(),
  check: jest.fn(),
}));

jest.mock('./publisher', () => ({
  initPublisher: jest.fn(),
}));

jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  getInstalledPackageVersion: jest.fn(),
}));

// eslint-disable-next-line import/order, import/first
import { extract, check } from './consumer';
// eslint-disable-next-line import/order, import/first
import { initPublisher } from './publisher';
// eslint-disable-next-line import/order, import/first
import { getInstalledPackageVersion } from './utils';

type MockedExtract = jest.MockedFunction<typeof extract>;
type MockedCheck = jest.MockedFunction<typeof check>;
type MockedInitPublisher = jest.MockedFunction<typeof initPublisher>;
type MockedGetInstalledPackageVersion = jest.MockedFunction<typeof getInstalledPackageVersion>;

const mockExtract = extract as MockedExtract;
const mockCheck = check as MockedCheck;
const mockInitPublisher = initPublisher as MockedInitPublisher;
const mockGetInstalledPackageVersion =
  getInstalledPackageVersion as MockedGetInstalledPackageVersion;

const defaultExtractResult = {
  created: 0,
  updated: 0,
  deleted: 0,
  changes: { created: [], updated: [], deleted: [] },
  sourcePackage: { name: 'my-pkg', version: '1.0.0' },
};

describe('CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    mockGetInstalledPackageVersion.mockReturnValue('1.0.0');
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
    it('should return 1 when --folders flag is missing', async () => {
      const exitCode = await cli(['node', 'cli.js', 'init']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--folders option is required'),
      );
    });

    it('should parse --folders and call initPublisher on success', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Initialized successfully',
        publishedFolders: ['docs', 'src'],
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--folders', 'docs,src']);

      expect(exitCode).toBe(0);
      expect(mockInitPublisher).toHaveBeenCalledWith(['docs', 'src']);
    });

    it('should return 0 when initPublisher succeeds with publishedFolders', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
        publishedFolders: ['docs'],
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--folders', 'docs']);
      expect(exitCode).toBe(0);
    });

    it('should return 0 when initPublisher succeeds without publishedFolders', async () => {
      mockInitPublisher.mockResolvedValue({
        success: true,
        message: 'Done',
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--folders', 'docs']);
      expect(exitCode).toBe(0);
    });

    it('should return 1 when initPublisher fails', async () => {
      mockInitPublisher.mockResolvedValue({
        success: false,
        message: 'Initialization failed: folder not found',
      });

      const exitCode = await cli(['node', 'cli.js', 'init', '--folders', 'nonexistent']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Initialization failed'));
    });
  });

  describe('extract subcommand', () => {
    it('should call extract and return 0 on success', async () => {
      mockExtract.mockResolvedValue({
        created: 2,
        updated: 1,
        deleted: 1,
        changes: {
          created: ['file1.md', 'file2.md'],
          updated: ['file3.md'],
          deleted: ['old.md'],
        },
        sourcePackage: { name: 'my-pkg', version: '1.0.0' },
      });

      const exitCode = await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output']);
      expect(exitCode).toBe(0);
      expect(mockExtract).toHaveBeenCalled();
    });

    it('should return 1 when no subcommand given after package name', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      const exitCode = await cli(['node', 'cli.js', 'my-pkg']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('subcommand required'));
    });

    it('should return 1 when invalid value given as subcommand', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      const exitCode = await cli(['node', 'cli.js', 'my-pkg', '/output']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('subcommand required'));
    });

    it('should pass --files flag patterns to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output', '--files', '**/*.md,**/*.ts']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.filenamePatterns).toContain('**/*.md');
      expect(config.filenamePatterns).toContain('**/*.ts');
    });

    it('should pass --allow-conflicts flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output', '--allow-conflicts']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.allowConflicts).toBe(true);
    });

    it('should pass --version flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output', '--version', '1.2.x']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.version).toBe('1.2.x');
    });

    it('should pass --content-regex flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output', '--content-regex', 'foo,bar']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.contentRegexes).toHaveLength(2);
    });

    it('should pass --output/-o flag to extract config', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '-o', '/custom-output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.outputDir).toContain('custom-output');
    });

    it('should use default filename patterns when --files not specified', async () => {
      mockExtract.mockResolvedValue(defaultExtractResult);

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output']);

      const config = mockExtract.mock.calls[0][0];
      expect(config.filenamePatterns).toContain('!package.json');
      expect(config.filenamePatterns).toContain('!bin/**');
    });

    it('should log created, updated and deleted files', async () => {
      mockExtract.mockResolvedValue({
        created: 2,
        updated: 1,
        deleted: 1,
        changes: {
          created: ['file1.md', 'file2.md'],
          updated: ['file3.md'],
          deleted: ['old.md'],
        },
        sourcePackage: { name: 'my-pkg', version: '1.0.0' },
      });

      await cli(['node', 'cli.js', 'my-pkg', 'extract', '/output']);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('file1.md');
      expect(allLogs).toContain('file3.md');
      expect(allLogs).toContain('old.md');
    });
  });

  describe('check subcommand', () => {
    it('should return 0 when check reports files in sync', async () => {
      mockCheck.mockResolvedValue({
        ok: true,
        differences: { missing: [], modified: [], extra: [] },
        sourcePackage: { name: 'my-pkg', version: '1.0.0' },
      });

      const exitCode = await cli(['node', 'cli.js', 'my-pkg', 'check', '/output']);
      expect(exitCode).toBe(0);
    });

    it('should return 2 when check finds missing files', async () => {
      mockCheck.mockResolvedValue({
        ok: false,
        differences: { missing: ['file1.md'], modified: [], extra: [] },
        sourcePackage: { name: 'my-pkg', version: '1.0.0' },
      });

      const exitCode = await cli(['node', 'cli.js', 'my-pkg', 'check', '/output']);
      expect(exitCode).toBe(2);
    });

    it('should return 2 and list differences when check finds modified files', async () => {
      mockCheck.mockResolvedValue({
        ok: false,
        differences: {
          missing: ['missing.md'],
          modified: ['modified.md'],
          extra: ['extra.md'],
        },
        sourcePackage: { name: 'my-pkg', version: '1.0.0' },
      });

      const exitCode = await cli(['node', 'cli.js', 'my-pkg', 'check', '/output']);
      expect(exitCode).toBe(2);

      const allLogs = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(allLogs).toContain('missing.md');
      expect(allLogs).toContain('modified.md');
      expect(allLogs).toContain('extra.md');
    });

    it('should pass --check flag in config', async () => {
      mockCheck.mockResolvedValue({
        ok: true,
        differences: { missing: [], modified: [], extra: [] },
        sourcePackage: { name: 'my-pkg', version: '1.0.0' },
      });

      await cli(['node', 'cli.js', 'my-pkg', 'check', '/output', '--check']);
      expect(mockCheck).toHaveBeenCalled();
    });
  });

  it('should return 1 for unknown subcommand', async () => {
    const exitCode = await cli(['node', 'cli.js', 'my-pkg', 'unknown-cmd']);
    expect(exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('subcommand required'));
  });
});
