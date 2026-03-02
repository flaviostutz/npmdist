import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  run,
  parseTagsFromArgv,
  filterEntriesByTags,
  collectAllTags,
  printHelp,
  buildPurgeCommand,
  applySymlinks,
  applyContentReplacements,
  checkContentReplacements,
} from './runner';
import { NpmdataExtractEntry } from './types';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn(),
}));

type MockedExecSync = jest.MockedFunction<typeof execSync>;
type MockedReadFileSync = jest.MockedFunction<typeof fs.readFileSync>;

const mockExecSync = execSync as MockedExecSync;
const mockReadFileSync = fs.readFileSync as MockedReadFileSync;

const BIN_DIR = '/fake/bin';
const EXTRACT_ARGV = ['node', 'script.js', 'extract'];

/** Capture the command string passed to execSync for the first call. */
function capturedCommand(): string {
  return mockExecSync.mock.calls[0][0] as string;
}

/** Capture all command strings passed to execSync across all calls. */
function capturedCommands(): string[] {
  return mockExecSync.mock.calls.map((call) => call[0] as string);
}

function setupPackageJson(content: Record<string, unknown>): void {
  mockReadFileSync.mockReturnValue(Buffer.from(JSON.stringify(content)));
}

describe('runner', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('run – entry resolution', () => {
    it('uses a single default entry when npmdata is absent', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
      expect(capturedCommand()).toContain(`--output "${path.resolve('.')}"`);
    });

    it('uses a single default entry when npmdata is an empty array', () => {
      setupPackageJson({ name: 'my-pkg', npmdata: [] });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
    });

    it('invokes execSync once per npmdata entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a' },
          { package: 'pkg-b', outputDir: './b' },
        ],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('passes stdio:inherit and cwd to execSync', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledWith(expect.any(String), {
        stdio: 'inherit',
        cwd: expect.any(String),
      });
    });

    it('passes the current working directory as cwd to execSync', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      const callOptions = mockExecSync.mock.calls[0][1] as { cwd?: string };
      expect(callOptions.cwd).toBe(process.cwd());
    });

    it('resolves a relative outputDir to an absolute path in the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'my-pkg', outputDir: 'data' }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(`--output "${path.resolve(process.cwd(), 'data')}"`);
    });

    it('resolves dot outputDir to the current working directory in the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'my-pkg', outputDir: '.' }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(`--output "${process.cwd()}"`);
    });

    it('resolves the CLI path and embeds it in the command', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      // The command must call node with an absolute path to main.js and invoke extract.
      expect(capturedCommand()).toMatch(/node ".+main\.js"/);
      expect(capturedCommand()).toContain('extract');
    });

    it('propagates errors thrown by execSync', () => {
      setupPackageJson({ name: 'my-pkg' });
      mockExecSync.mockImplementation(() => {
        throw new Error('command failed');
      });

      expect(() => run(BIN_DIR, EXTRACT_ARGV)).toThrow('command failed');
    });
  });

  describe('buildExtractCommand – flag assembly', () => {
    it('builds a minimal command with only required fields', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: './out' }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      const cmd = capturedCommand();
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).toContain(`--output "${path.resolve('./out')}"`);
      expect(cmd).not.toContain('--force');
      expect(cmd).not.toContain('--no-gitignore');
      expect(cmd).not.toContain('--unmanaged');
      expect(cmd).not.toContain('--silent');
      expect(cmd).not.toContain('--dry-run');
      expect(cmd).not.toContain('--upgrade');
      expect(cmd).not.toContain('--files');
      expect(cmd).not.toContain('--content-regex');
    });

    it('adds --force when force is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', force: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --force');
    });

    it('omits --force when force is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', force: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--force');
    });

    it('adds --keep-existing when keepExisting is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', keepExisting: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --keep-existing');
    });

    it('omits --keep-existing when keepExisting is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', keepExisting: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--keep-existing');
    });

    it('omits --no-gitignore when gitignore is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', gitignore: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--no-gitignore');
    });

    it('adds --no-gitignore when gitignore is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', gitignore: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --no-gitignore');
    });

    it('adds --silent when silent is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', silent: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --silent');
    });

    it('adds --dry-run when dryRun is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', dryRun: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --dry-run');
    });

    it('adds --upgrade when upgrade is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', upgrade: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --upgrade');
    });

    it('adds --unmanaged when unmanaged is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', unmanaged: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --unmanaged');
    });

    it('omits --unmanaged when unmanaged is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', unmanaged: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--unmanaged');
    });

    it('adds --files with a single file pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--files "**/*.md"');
    });

    it('joins multiple file patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md', 'data/**'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--files "**/*.md,data/**"');
    });

    it('omits --files when files array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: [] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--files');
    });

    it('adds --content-regex with a single regex pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar"');
    });

    it('joins multiple content regex patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar', '^baz'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar,^baz"');
    });

    it('omits --content-regex when contentRegexes array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: [] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--content-regex');
    });

    it('builds a command with all flags enabled', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [
          {
            package: 'full-pkg@^2.0.0',
            outputDir: './data',
            force: true,
            gitignore: false,
            silent: true,
            dryRun: true,
            upgrade: true,
            files: ['**/*.json', 'docs/**'],
            contentRegexes: ['schema', 'version'],
          },
        ],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      const cmd = capturedCommand();
      expect(cmd).toContain('--packages "full-pkg@^2.0.0"');
      expect(cmd).toContain(`--output "${path.resolve('./data')}"`);
      expect(cmd).toContain(' --force');
      expect(cmd).toContain(' --no-gitignore');
      expect(cmd).toContain(' --silent');
      expect(cmd).toContain(' --dry-run');
      expect(cmd).toContain(' --upgrade');
      expect(cmd).toContain('--files "**/*.json,docs/**"');
      expect(cmd).toContain('--content-regex "schema,version"');
    });

    it('uses the resolved CLI path in the command', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.' }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      // The command must reference an absolute path to main.js and contain the extract sub-command.
      expect(capturedCommand()).toMatch(/node ".+main\.js"/);
      expect(capturedCommand()).toContain('extract');
    });
  });

  describe('parseTagsFromArgv', () => {
    it('returns an empty array when --tags is not present', () => {
      expect(parseTagsFromArgv(['node', 'script.js'])).toEqual([]);
    });

    it('returns a single tag when --tags has one value', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', 'prod'])).toEqual(['prod']);
    });

    it('splits comma-separated tags', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', 'prod,staging'])).toEqual([
        'prod',
        'staging',
      ]);
    });

    it('trims whitespace from tags', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', ' prod , staging '])).toEqual([
        'prod',
        'staging',
      ]);
    });

    it('ignores --tags when there is no following value', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags'])).toEqual([]);
    });

    it('filters out empty strings produced by trailing commas', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', 'prod,'])).toEqual(['prod']);
    });
  });

  describe('filterEntriesByTags', () => {
    const entryA: NpmdataExtractEntry = { package: 'pkg-a', outputDir: './a', tags: ['prod'] };
    const entryB: NpmdataExtractEntry = {
      package: 'pkg-b',
      outputDir: './b',
      tags: ['staging', 'prod'],
    };
    const entryC: NpmdataExtractEntry = { package: 'pkg-c', outputDir: './c', tags: ['dev'] };
    const entryNoTags: NpmdataExtractEntry = { package: 'pkg-d', outputDir: './d' };

    it('returns all entries when requestedTags is empty', () => {
      expect(filterEntriesByTags([entryA, entryB, entryC, entryNoTags], [])).toEqual([
        entryA,
        entryB,
        entryC,
        entryNoTags,
      ]);
    });

    it('returns only entries matching the requested tag', () => {
      expect(filterEntriesByTags([entryA, entryB, entryC, entryNoTags], ['prod'])).toEqual([
        entryA,
        entryB,
      ]);
    });

    it('returns entries matching any of the requested tags', () => {
      expect(
        filterEntriesByTags([entryA, entryB, entryC, entryNoTags], ['dev', 'staging']),
      ).toEqual([entryB, entryC]);
    });

    it('excludes entries with no tags when a tag filter is active', () => {
      expect(filterEntriesByTags([entryNoTags], ['prod'])).toEqual([]);
    });

    it('returns an empty array when no entries match', () => {
      expect(filterEntriesByTags([entryA, entryC], ['staging'])).toEqual([]);
    });
  });

  describe('run – tags filtering', () => {
    it('runs all entries when --tags is not provided', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('runs only entries matching the requested tag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // 1 extract for pkg-a, 1 purge for excluded pkg-b
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('extract') && c.includes('pkg-a'))).toBe(true);
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-b'))).toBe(true);
    });

    it('runs entries matching any of the requested tags', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod,staging']);

      // 2 extracts (pkg-a, pkg-b) + 1 purge (excluded pkg-c)
      expect(mockExecSync).toHaveBeenCalledTimes(3);
      const cmds = capturedCommands();
      expect(cmds.filter((c) => c.includes('extract')).length).toBe(2);
      expect(cmds.filter((c) => c.includes('purge')).length).toBe(1);
    });

    it('runs no extract commands but purges all entries when no entry matches the requested tag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['dev'] }],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // No extract, but purge is called for the excluded entry
      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('purge');
      expect(capturedCommand()).not.toContain('extract');
    });

    it('skips entries without tags from extract but purges them when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a' },
          { package: 'pkg-b', outputDir: './b', tags: ['prod'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // 1 extract (pkg-b) + 1 purge (untagged pkg-a)
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('extract') && c.includes('pkg-b'))).toBe(true);
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-a'))).toBe(true);
    });

    it('does not pass --tags to the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      expect(capturedCommand()).not.toContain('--tags');
    });
  });

  describe('run – purge excluded entries when tags filter is active', () => {
    it('purges excluded entries when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // One extract call for pkg-a, one purge call for pkg-b
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('extract') && c.includes('pkg-a'))).toBe(true);
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-b'))).toBe(true);
    });

    it('does not purge anything when no tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract']);

      // Both entries extracted, no purge
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => !c.includes('purge'))).toBe(true);
    });

    it('purges all excluded entries when multiple are excluded', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // 1 extract (pkg-a), 2 purges (pkg-b, pkg-c)
      expect(mockExecSync).toHaveBeenCalledTimes(3);
      const cmds = capturedCommands();
      expect(cmds.filter((c) => c.includes('extract')).length).toBe(1);
      expect(cmds.filter((c) => c.includes('purge')).length).toBe(2);
    });

    it('purges entries without tags when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-untagged', outputDir: './u' },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-untagged'))).toBe(true);
    });

    it('purges nothing (only extract) when all entries match the tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['prod', 'staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('extract'))).toBe(true);
    });

    it('runs only purge commands when no entries match the tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['staging'] },
          { package: 'pkg-b', outputDir: './b', tags: ['dev'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('purge'))).toBe(true);
    });
  });

  describe('buildPurgeCommand', () => {
    const CLI_PATH = '/path/to/main.js';
    const PURGE_CWD = '/my/project';

    it('builds a purge command with package name and resolved absolute output dir', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: './out' };
      const cmd = buildPurgeCommand(CLI_PATH, entry, PURGE_CWD);
      expect(cmd).toContain('purge');
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).toContain('--output "/my/project/out"');
    });

    it('resolves a relative outputDir to an absolute path', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: 'data' };
      const cmd = buildPurgeCommand(CLI_PATH, entry, '/project/root');
      expect(cmd).toContain('--output "/project/root/data"');
    });

    it('resolves dot outputDir to the cwd itself', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildPurgeCommand(CLI_PATH, entry, '/project/root');
      expect(cmd).toContain('--output "/project/root"');
    });

    it('resolves an absolute outputDir as-is, ignoring cwd', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '/absolute/path' };
      const cmd = buildPurgeCommand(CLI_PATH, entry, '/project/root');
      expect(cmd).toContain('--output "/absolute/path"');
    });

    it('strips version specifier from the package name', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg@^2.0.0', outputDir: '.' };
      const cmd = buildPurgeCommand(CLI_PATH, entry, PURGE_CWD);
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).not.toContain('2.0.0');
    });

    it('adds --silent when entry has silent: true', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.', silent: true };
      const cmd = buildPurgeCommand(CLI_PATH, entry, PURGE_CWD);
      expect(cmd).toContain(' --silent');
    });

    it('adds --dry-run when entry has dryRun: true', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.', dryRun: true };
      const cmd = buildPurgeCommand(CLI_PATH, entry, PURGE_CWD);
      expect(cmd).toContain(' --dry-run');
    });

    it('uses node and the provided CLI path', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildPurgeCommand(CLI_PATH, entry, PURGE_CWD);
      expect(cmd).toMatch(/node ".+main\.js"/);
    });

    it('uses process.cwd() as default cwd when none is provided', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: 'out' };
      const cmd = buildPurgeCommand(CLI_PATH, entry);
      expect(cmd).toContain(`--output "${path.resolve(process.cwd(), 'out')}"`);
    });
  });

  describe('collectAllTags', () => {
    it('returns an empty array when no entry has tags', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a' },
        { package: 'pkg-b', outputDir: './b' },
      ];
      expect(collectAllTags(entries)).toEqual([]);
    });

    it('collects tags from a single entry', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['prod', 'staging'] },
      ];
      expect(collectAllTags(entries)).toEqual(['prod', 'staging']);
    });

    it('deduplicates tags across entries', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
        { package: 'pkg-b', outputDir: './b', tags: ['prod', 'staging'] },
        { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
      ];
      expect(collectAllTags(entries)).toEqual(['dev', 'prod', 'staging']);
    });

    it('returns tags sorted alphabetically', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['zzz', 'aaa', 'mmm'] },
      ];
      expect(collectAllTags(entries)).toEqual(['aaa', 'mmm', 'zzz']);
    });

    it('ignores entries with undefined tags', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
        { package: 'pkg-b', outputDir: './b' },
      ];
      expect(collectAllTags(entries)).toEqual(['prod']);
    });

    it('returns an empty array for an empty entries list', () => {
      expect(collectAllTags([])).toEqual([]);
    });
  });

  describe('printHelp', () => {
    it('includes the package name in the output', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg');
      writeSpy.mockRestore();
    });

    it('lists available tags in the output', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', ['dev', 'prod', 'staging']);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('dev, prod, staging');
      writeSpy.mockRestore();
    });

    it('shows a placeholder when no tags are available', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('(none defined in package.json)');
      writeSpy.mockRestore();
    });

    it('mentions --tags option', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('--tags');
      writeSpy.mockRestore();
    });

    it('mentions --help option', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('--help');
      writeSpy.mockRestore();
    });

    it('shows an extract-without-tags example using the package name', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', ['prod']);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg extract');
      expect(output).toContain('Extract files for all entries');
      writeSpy.mockRestore();
    });

    it('shows an extract-with-tags example using the first available tag', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', ['prod', 'staging']);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg extract --tags prod');
      expect(output).toContain('"prod"');
      writeSpy.mockRestore();
    });

    it('uses "my-tag" as placeholder tag in example when no tags are defined', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg extract --tags my-tag');
      writeSpy.mockRestore();
    });
  });

  describe('run – --help flag', () => {
    it('prints help and does not run any extractions when --help is present', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }],
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('includes package name in help output', () => {
      setupPackageJson({ name: 'my-special-pkg' });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-special-pkg');
      writeSpy.mockRestore();
    });

    it('lists tags from npmdata entries in help output', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging', 'prod'] },
        ],
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('prod');
      expect(output).toContain('staging');
      writeSpy.mockRestore();
    });

    it('shows placeholder when no tags are defined', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a' }],
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('(none defined in package.json)');
      writeSpy.mockRestore();
    });
  });

  describe('run – default help', () => {
    it('shows help and does not extract when no action is provided', () => {
      setupPackageJson({ name: 'my-pkg' });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js']);

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('shows help when invoked with only the node and script args (default argv)', () => {
      setupPackageJson({ name: 'my-pkg' });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-pkg');
      expect(output).toContain('extract');
      writeSpy.mockRestore();
    });
  });

  describe('run – unknown action', () => {
    it('prints an error and help without extracting for an unknown action', () => {
      setupPackageJson({ name: 'my-pkg' });
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'bogus']);

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalled();
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    });

    it('includes the unknown action name in the error message', () => {
      setupPackageJson({ name: 'my-pkg' });
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'bogus']);

      const errOutput = stderrSpy.mock.calls[0][0] as string;
      expect(errOutput).toContain('bogus');
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    });
  });

  // ─── applySymlinks ──────────────────────────────────────────────────────────
  describe('applySymlinks', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      // These tests need real filesystem; restore readFileSync to the actual implementation.
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-symlinks-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('does nothing when entry has no symlinks config', () => {
      const entry: NpmdataExtractEntry = { package: 'pkg', outputDir: './out' };
      // Should not throw
      expect(() => applySymlinks(entry, tmpDir)).not.toThrow();
    });

    it('does nothing when symlinks array is empty', () => {
      const entry: NpmdataExtractEntry = { package: 'pkg', outputDir: './out', symlinks: [] };
      expect(() => applySymlinks(entry, tmpDir)).not.toThrow();
    });

    it('creates target directory if it does not exist', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });

      const targetDir = path.join(tmpDir, '.github', 'skills');
      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      expect(fs.existsSync(targetDir)).toBe(true);
    });

    it('creates a symlink for each matched file in the outputDir', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-b'), { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '# Skill A');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      const targetDir = path.join(tmpDir, '.github', 'skills');
      const symlinkA = path.join(targetDir, 'skill-a');
      const symlinkB = path.join(targetDir, 'skill-b');

      expect(fs.lstatSync(symlinkA).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(symlinkA)).toBe(
        fs.realpathSync(path.join(outputDir, 'skills', 'skill-a')),
      );
      expect(fs.lstatSync(symlinkB).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(symlinkB)).toBe(
        fs.realpathSync(path.join(outputDir, 'skills', 'skill-b')),
      );
    });

    it('removes stale managed symlinks that no longer match the glob', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      // Simulate a stale symlink created by a previous extraction run that pointed
      // into outputDir but whose source no longer exists there.  The symlink is dead.
      const staleTarget = path.join(outputDir, 'skills', 'skill-OLD');
      fs.symlinkSync(staleTarget, path.join(targetDir, 'skill-OLD'));

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      // Stale symlink must be removed; new one must be created.
      // Use lstatSync (does NOT follow links) so a dead symlink is also detected.
      const oldLinkGone = ((): boolean => {
        // eslint-disable-next-line functional/no-try-statements
        try {
          fs.lstatSync(path.join(targetDir, 'skill-OLD'));
          return false;
        } catch {
          return true;
        }
      })();
      expect(oldLinkGone).toBe(true);
      expect(fs.lstatSync(path.join(targetDir, 'skill-a')).isSymbolicLink()).toBe(true);
    });

    it('does not touch symlinks that do not point into outputDir', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      const externalDir = path.join(tmpDir, 'external');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.mkdirSync(externalDir, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      // Non-managed symlink pointing outside outputDir
      fs.symlinkSync(externalDir, path.join(targetDir, 'external-link'));

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      // External symlink must survive
      expect(fs.lstatSync(path.join(targetDir, 'external-link')).isSymbolicLink()).toBe(true);
    });

    it('does not clobber an existing non-symlink at the target basename', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      // A regular directory exists at the target name
      const existing = path.join(targetDir, 'skill-a');
      fs.mkdirSync(existing, { recursive: true });

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      // Must remain a regular directory, not a symlink
      expect(fs.lstatSync(existing).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(existing).isDirectory()).toBe(true);
    });

    it('is idempotent: running twice produces the same result', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);
      applySymlinks(entry, tmpDir);

      const targetDir = path.join(tmpDir, '.github', 'skills');
      expect(fs.lstatSync(path.join(targetDir, 'skill-a')).isSymbolicLink()).toBe(true);
    });
  });

  // ─── applyContentReplacements ───────────────────────────────────────────────
  describe('applyContentReplacements', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      // These tests need real filesystem; restore readFileSync to the actual implementation.
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-content-replace-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('does nothing when entry has no contentReplacements config', () => {
      const entry: NpmdataExtractEntry = { package: 'pkg', outputDir: './out' };
      expect(() => applyContentReplacements(entry, tmpDir)).not.toThrow();
    });

    it('does nothing when contentReplacements array is empty', () => {
      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [],
      };
      expect(() => applyContentReplacements(entry, tmpDir)).not.toThrow();
    });

    it('replaces matching content in workspace files', () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'docs', 'README.md'),
        '# Title\n<!-- version: 0.0.0 -->\nBody',
      );

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [
          {
            files: 'docs/**/*.md',
            match: '<!-- version: .* -->',
            replace: '<!-- version: 1.2.3 -->',
          },
        ],
      };

      applyContentReplacements(entry, tmpDir);

      const updated = fs.readFileSync(path.join(tmpDir, 'docs', 'README.md'), 'utf8');
      expect(updated).toContain('<!-- version: 1.2.3 -->');
      expect(updated).not.toContain('<!-- version: 0.0.0 -->');
    });

    it('replaces all occurrences across multiple files', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.md'), 'TOKEN');
      fs.writeFileSync(path.join(tmpDir, 'b.md'), 'TOKEN and TOKEN');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: 'TOKEN', replace: 'REPLACED' }],
      };

      applyContentReplacements(entry, tmpDir);

      expect(fs.readFileSync(path.join(tmpDir, 'a.md'), 'utf8')).toBe('REPLACED');
      expect(fs.readFileSync(path.join(tmpDir, 'b.md'), 'utf8')).toBe('REPLACED and REPLACED');
    });

    it('does not write a file when content does not change', () => {
      const filePath = path.join(tmpDir, 'no-match.md');
      fs.writeFileSync(filePath, 'nothing to replace here');
      const before = fs.statSync(filePath).mtimeMs;

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: 'TOKEN', replace: 'REPLACED' }],
      };

      applyContentReplacements(entry, tmpDir);

      expect(fs.statSync(filePath).mtimeMs).toBe(before);
    });

    it('supports regex back-references in the replacement string', () => {
      fs.writeFileSync(path.join(tmpDir, 'ref.md'), 'hello world');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: '(hello) (world)', replace: '$2 $1' }],
      };

      applyContentReplacements(entry, tmpDir);

      expect(fs.readFileSync(path.join(tmpDir, 'ref.md'), 'utf8')).toBe('world hello');
    });
  });

  // ─── checkContentReplacements ───────────────────────────────────────────────
  describe('checkContentReplacements', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      // These tests need real filesystem; restore readFileSync to the actual implementation.
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-check-replace-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('returns an empty array when no contentReplacements are defined', () => {
      const entry: NpmdataExtractEntry = { package: 'pkg', outputDir: './out' };
      expect(checkContentReplacements(entry, tmpDir)).toEqual([]);
    });

    it('returns an empty array when all replacements are already applied', () => {
      fs.writeFileSync(path.join(tmpDir, 'doc.md'), '<!-- version: 1.2.3 -->');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [
          { files: '*.md', match: '<!-- version: .* -->', replace: '<!-- version: 1.2.3 -->' },
        ],
      };

      // No further changes needed – regex matches but replacement string equals its own output.
      // Build a case where the replacement produces no diff.
      // We write the file already containing the replacement text, so match succeeds but diff is zero.
      expect(checkContentReplacements(entry, tmpDir)).toEqual([]);
    });

    it('returns paths of files where the replacement would still change content', () => {
      const filePath = path.join(tmpDir, 'doc.md');
      fs.writeFileSync(filePath, '<!-- version: 0.0.0 -->');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [
          { files: '*.md', match: '<!-- version: 0.0.0 -->', replace: '<!-- version: 1.0.0 -->' },
        ],
      };

      const outOfSync = checkContentReplacements(entry, tmpDir);
      expect(outOfSync).toContain(filePath);
    });

    it('does not return a path when the file content would not change', () => {
      const filePath = path.join(tmpDir, 'up-to-date.md');
      fs.writeFileSync(filePath, 'no marker here');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: 'MARKER', replace: 'REPLACED' }],
      };

      const outOfSync = checkContentReplacements(entry, tmpDir);
      expect(outOfSync).not.toContain(filePath);
    });
  });
});
