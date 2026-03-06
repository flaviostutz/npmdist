/* eslint-disable no-undefined */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  run,
  runEntries,
  parseTagsFromArgv,
  parseOutputFromArgv,
  parseDryRunFromArgv,
  parseSilentFromArgv,
  parseNoGitignoreFromArgv,
  parseUnmanagedFromArgv,
  filterEntriesByTags,
  collectAllTags,
  printHelp,
  buildCheckCommand,
  buildListCommand,
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
  mkdirSync: jest.fn(),
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
      setupPackageJson({ name: 'my-pkg', npmdata: { sets: [] } });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
    });

    it('invokes execSync once per npmdata entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('passes cwd to execSync when running extract', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cwd: expect.any(String) }),
      );
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
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(`--output "${path.resolve(process.cwd(), 'data')}"`);
    });

    it('resolves dot outputDir to the current working directory in the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
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

    it('calls process.exit with child exit code when execSync throws', () => {
      setupPackageJson({ name: 'my-pkg' });
      const exitError = Object.assign(new Error('command failed'), { status: 2 });
      mockExecSync.mockImplementation(() => {
        throw exitError;
      });
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      expect(() => run(BIN_DIR, EXTRACT_ARGV)).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(2);
      mockExit.mockRestore();
    });

    it('calls process.exit with 1 when execSync throws without a status code', () => {
      setupPackageJson({ name: 'my-pkg' });
      mockExecSync.mockImplementation(() => {
        throw new Error('command failed');
      });
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      expect(() => run(BIN_DIR, EXTRACT_ARGV)).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it('uses --output dir as base when resolving outputDir in the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--output', '/custom/base']);

      expect(capturedCommand()).toContain(`--output "${path.resolve('/custom/base', 'data')}"`);
    });

    it('uses -o shorthand as base when resolving outputDir', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '-o', '/custom/base']);

      expect(capturedCommand()).toContain(`--output "${path.resolve('/custom/base', 'data')}"`);
    });

    it('resolves a relative --output against process.cwd()', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--output', 'projects/myapp']);

      const expectedBase = path.resolve(process.cwd(), 'projects/myapp');
      expect(capturedCommand()).toContain(`--output "${path.resolve(expectedBase, 'data')}"`);
    });

    it('uses --output dir as cwd passed to execSync', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--output', '/custom/base']);

      const callOptions = mockExecSync.mock.calls[0][1] as { cwd?: string };
      expect(callOptions.cwd).toBe('/custom/base');
    });
  });

  describe('buildExtractCommand – flag assembly', () => {
    it('builds a minimal command with only required fields', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: './out' }] },
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
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', force: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --force');
    });

    it('omits --force when force is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', force: false }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--force');
    });

    it('adds --keep-existing when keepExisting is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', keepExisting: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --keep-existing');
    });

    it('omits --keep-existing when keepExisting is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', keepExisting: false }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--keep-existing');
    });

    it('omits --no-gitignore when gitignore is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', gitignore: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--no-gitignore');
    });

    it('adds --no-gitignore when gitignore is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', gitignore: false }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --no-gitignore');
    });

    it('adds --silent when silent is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', silent: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --silent');
    });

    it('adds --dry-run when dryRun is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', dryRun: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --dry-run');
    });

    it('adds --upgrade when upgrade is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', upgrade: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --upgrade');
    });

    it('adds --unmanaged when unmanaged is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', unmanaged: true }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --unmanaged');
    });

    it('omits --unmanaged when unmanaged is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', unmanaged: false }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--unmanaged');
    });

    it('adds --files with a single file pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md'] }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--files "**/*.md"');
    });

    it('joins multiple file patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md', 'data/**'] }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--files "**/*.md,data/**"');
    });

    it('omits --files when files array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', files: [] }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--files');
    });

    it('adds --content-regex with a single regex pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar'] }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar"');
    });

    it('joins multiple content regex patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar', '^baz'] }],
        },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar,^baz"');
    });

    it('omits --content-regex when contentRegexes array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', contentRegexes: [] }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--content-regex');
    });

    it('builds a command with all flags enabled', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: {
          sets: [
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
        },
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
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
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

  describe('parseOutputFromArgv', () => {
    it('returns undefined when --output is not present', () => {
      expect(parseOutputFromArgv(['node', 'script.js', 'extract'])).toBeUndefined();
    });

    it('returns the value after --output', () => {
      expect(parseOutputFromArgv(['node', 'script.js', '--output', '/some/dir'])).toBe('/some/dir');
    });

    it('returns the value after -o shorthand', () => {
      expect(parseOutputFromArgv(['node', 'script.js', '-o', '/some/dir'])).toBe('/some/dir');
    });

    it('returns undefined when --output appears as the last argument with no value', () => {
      expect(parseOutputFromArgv(['node', 'script.js', '--output'])).toBeUndefined();
    });

    it('works when --output appears alongside other flags', () => {
      expect(
        parseOutputFromArgv([
          'node',
          'script.js',
          'extract',
          '--tags',
          'prod',
          '--output',
          './out',
        ]),
      ).toBe('./out');
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('runs only entries matching the requested tag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
            { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
          ],
        },
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
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a', tags: ['dev'] }] },
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b', tags: ['prod'] },
          ],
        },
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
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      expect(capturedCommand()).not.toContain('--tags');
    });
  });

  describe('run – purge excluded entries when tags filter is active', () => {
    it('purges excluded entries when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
            { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
          ],
        },
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-untagged', outputDir: './u' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-untagged'))).toBe(true);
    });

    it('purges nothing (only extract) when all entries match the tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['prod', 'staging'] },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('extract'))).toBe(true);
    });

    it('runs only purge commands when no entries match the tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['staging'] },
            { package: 'pkg-b', outputDir: './b', tags: ['dev'] },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('purge'))).toBe(true);
    });
  });

  describe('parseDryRunFromArgv', () => {
    it('returns false when --dry-run is not present', () => {
      expect(parseDryRunFromArgv(['node', 'script.js', 'extract'])).toBe(false);
    });

    it('returns true when --dry-run is present', () => {
      expect(parseDryRunFromArgv(['node', 'script.js', 'extract', '--dry-run'])).toBe(true);
    });

    it('returns false for an empty array', () => {
      expect(parseDryRunFromArgv([])).toBe(false);
    });

    it('returns false when only similar-but-different flags are present', () => {
      expect(parseDryRunFromArgv(['node', 'script.js', '--no-gitignore'])).toBe(false);
    });
  });

  describe('parseSilentFromArgv', () => {
    it('returns false when --silent is not present', () => {
      expect(parseSilentFromArgv(['node', 'script.js', 'extract'])).toBe(false);
    });

    it('returns true when --silent is present', () => {
      expect(parseSilentFromArgv(['node', 'script.js', 'extract', '--silent'])).toBe(true);
    });

    it('returns false for an empty array', () => {
      expect(parseSilentFromArgv([])).toBe(false);
    });
  });

  describe('parseNoGitignoreFromArgv', () => {
    it('returns false when --no-gitignore is not present', () => {
      expect(parseNoGitignoreFromArgv(['node', 'script.js', 'extract'])).toBe(false);
    });

    it('returns true when --no-gitignore is present', () => {
      expect(parseNoGitignoreFromArgv(['node', 'script.js', 'extract', '--no-gitignore'])).toBe(
        true,
      );
    });

    it('returns false for an empty array', () => {
      expect(parseNoGitignoreFromArgv([])).toBe(false);
    });

    it('returns false when only similar-but-different flags are present', () => {
      expect(parseNoGitignoreFromArgv(['node', 'script.js', '--dry-run'])).toBe(false);
    });
  });

  describe('parseUnmanagedFromArgv', () => {
    it('returns false when --unmanaged is not present', () => {
      expect(parseUnmanagedFromArgv(['node', 'script.js', 'extract'])).toBe(false);
    });

    it('returns true when --unmanaged is present', () => {
      expect(parseUnmanagedFromArgv(['node', 'script.js', 'extract', '--unmanaged'])).toBe(true);
    });

    it('returns false for an empty array', () => {
      expect(parseUnmanagedFromArgv([])).toBe(false);
    });

    it('returns false when only similar-but-different flags are present', () => {
      expect(parseUnmanagedFromArgv(['node', 'script.js', '--dry-run'])).toBe(false);
    });
  });

  describe('run – --unmanaged argv override', () => {
    it('adds --unmanaged to the extract command when the flag is in argv', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--unmanaged']);

      expect(capturedCommand()).toContain(' --unmanaged');
    });

    it('overrides entry-level unmanaged:false and adds --unmanaged to the command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', unmanaged: false }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--unmanaged']);

      expect(capturedCommand()).toContain(' --unmanaged');
    });

    it('does not add --unmanaged when the flag is absent', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--unmanaged');
    });

    it('applies --unmanaged override across all entries', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b', unmanaged: false },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--unmanaged']);

      const cmds = capturedCommands();
      expect(cmds).toHaveLength(2);
      expect(cmds[0]).toContain(' --unmanaged');
      expect(cmds[1]).toContain(' --unmanaged');
    });
  });

  describe('run – --no-gitignore argv override', () => {
    it('adds --no-gitignore to the extract command when the flag is in argv', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--no-gitignore']);

      expect(capturedCommand()).toContain(' --no-gitignore');
    });

    it('overrides entry-level gitignore:true and adds --no-gitignore to the command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', gitignore: true }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--no-gitignore']);

      expect(capturedCommand()).toContain(' --no-gitignore');
    });

    it('does not add --no-gitignore when the flag is absent', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--no-gitignore');
    });

    it('applies --no-gitignore override across all entries', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', gitignore: true },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--no-gitignore']);

      const cmds = capturedCommands();
      expect(cmds).toHaveLength(2);
      expect(cmds[0]).toContain(' --no-gitignore');
      expect(cmds[1]).toContain(' --no-gitignore');
    });
  });

  describe('buildCheckCommand', () => {
    const CLI_PATH = '/path/to/main.js';
    const CHECK_CWD = '/my/project';

    it('builds a check command with package and resolved output dir', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: './out' };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).toContain('check');
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).toContain('--output "/my/project/out"');
    });

    it('resolves a relative outputDir to an absolute path', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: 'data' };
      const cmd = buildCheckCommand(CLI_PATH, entry, '/project/root');
      expect(cmd).toContain('--output "/project/root/data"');
    });

    it('resolves dot outputDir to the cwd itself', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildCheckCommand(CLI_PATH, entry, '/project/root');
      expect(cmd).toContain('--output "/project/root"');
    });

    it('preserves a version specifier in the package name', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg@^2.0.0', outputDir: '.' };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).toContain('--packages "my-pkg@^2.0.0"');
    });

    it('uses node and the provided CLI path', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).toMatch(/node ".+main\.js"/);
    });

    it('uses process.cwd() as default cwd when none is provided', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: 'out' };
      const cmd = buildCheckCommand(CLI_PATH, entry);
      expect(cmd).toContain(`--output "${path.resolve(process.cwd(), 'out')}"`);
    });

    it('includes --files flag when files are specified', () => {
      const entry: NpmdataExtractEntry = {
        package: 'my-pkg',
        outputDir: '.',
        files: ['*.md', 'docs/**'],
      };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).toContain('--files "*.md,docs/**"');
    });

    it('omits --files flag when files is not set', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).not.toContain('--files');
    });

    it('omits --files flag when files is an empty array', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.', files: [] };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).not.toContain('--files');
    });

    it('includes --content-regex flag when contentRegexes are specified', () => {
      const entry: NpmdataExtractEntry = {
        package: 'my-pkg',
        outputDir: '.',
        contentRegexes: ['foo.*bar', '^version:'],
      };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).toContain('--content-regex "foo.*bar,^version:"');
    });

    it('omits --content-regex flag when contentRegexes is not set', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).not.toContain('--content-regex');
    });

    it('omits --content-regex flag when contentRegexes is an empty array', () => {
      const entry: NpmdataExtractEntry = {
        package: 'my-pkg',
        outputDir: '.',
        contentRegexes: [],
      };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).not.toContain('--content-regex');
    });

    it('includes both --files and --content-regex when both are set', () => {
      const entry: NpmdataExtractEntry = {
        package: 'my-pkg',
        outputDir: './out',
        files: ['data/**'],
        contentRegexes: ['pattern'],
      };
      const cmd = buildCheckCommand(CLI_PATH, entry, CHECK_CWD);
      expect(cmd).toContain('--files "data/**"');
      expect(cmd).toContain('--content-regex "pattern"');
    });
  });

  describe('buildListCommand', () => {
    const CLI_PATH = '/path/to/main.js';
    const LIST_CWD = '/my/project';

    it('builds a list command with the resolved output dir', () => {
      const cmd = buildListCommand(CLI_PATH, './out', LIST_CWD);
      expect(cmd).toContain('list');
      expect(cmd).toContain('--output "/my/project/out"');
    });

    it('resolves a relative outputDir to an absolute path', () => {
      const cmd = buildListCommand(CLI_PATH, 'data', '/project/root');
      expect(cmd).toContain('--output "/project/root/data"');
    });

    it('resolves dot outputDir to the cwd itself', () => {
      const cmd = buildListCommand(CLI_PATH, '.', '/project/root');
      expect(cmd).toContain('--output "/project/root"');
    });

    it('uses node and the provided CLI path', () => {
      const cmd = buildListCommand(CLI_PATH, '.', LIST_CWD);
      expect(cmd).toMatch(/node ".+main\.js"/);
    });

    it('uses process.cwd() as default cwd when none is provided', () => {
      const cmd = buildListCommand(CLI_PATH, 'out');
      expect(cmd).toContain(`--output "${path.resolve(process.cwd(), 'out')}"`);
    });

    it('does not include --packages in the command', () => {
      const cmd = buildListCommand(CLI_PATH, '.', LIST_CWD);
      expect(cmd).not.toContain('--packages');
    });
  });

  describe('run – check action', () => {
    it('runs a check command for each entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('check'))).toBe(true);
    });

    it('passes correct package and output dir in the check command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a@^1.0.0', outputDir: './data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      const cmd = capturedCommand();
      expect(cmd).toContain('check');
      expect(cmd).toContain('--packages "pkg-a@^1.0.0"');
      expect(cmd).toContain(`--output "${path.resolve('./data')}"`);
    });

    it('respects --tags when running check', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('pkg-a');
    });

    it('uses --output as base dir for resolving outputDir in check', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'check', '--output', '/custom/base']);

      expect(capturedCommand()).toContain(`--output "${path.resolve('/custom/base', 'data')}"`);
    });

    it('uses default entry when npmdata is absent', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
    });

    it('passes --files from entry to check command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './data', files: ['*.md', 'docs/**'] }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      expect(capturedCommand()).toContain('--files "*.md,docs/**"');
    });

    it('passes --content-regex from entry to check command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'pkg-a', outputDir: './data', contentRegexes: ['foo.*bar'] }],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar"');
    });

    it('passes both --files and --content-regex from entry to check command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            {
              package: 'pkg-a',
              outputDir: './data',
              files: ['data/**'],
              contentRegexes: ['pattern'],
            },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      const cmd = capturedCommand();
      expect(cmd).toContain('--files "data/**"');
      expect(cmd).toContain('--content-regex "pattern"');
    });

    it('skips entries with unmanaged:true during check', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-managed', outputDir: './a' },
            { package: 'pkg-unmanaged', outputDir: './b', unmanaged: true },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('pkg-managed');
      expect(capturedCommand()).not.toContain('pkg-unmanaged');
    });

    it('skips all entries during check when --unmanaged flag is set', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check', '--unmanaged']);

      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('run – check action with contentReplacements', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      (fs.mkdirSync as jest.Mock).mockImplementation(
        jest.requireActual<typeof fs>('node:fs').mkdirSync,
      );
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-run-check-cr-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('exits with status 1 and writes to stderr when contentReplacements are out of sync', () => {
      mockReadFileSync.mockReturnValueOnce(
        Buffer.from(
          JSON.stringify({
            name: 'my-pkg',
            npmdata: {
              sets: [
                {
                  package: 'pkg-a',
                  outputDir: '.',
                  contentReplacements: [
                    { files: 'doc.md', match: '<!-- old -->', replace: '<!-- new -->' },
                  ],
                },
              ],
            },
          }),
        ),
      );
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      fs.writeFileSync(path.join(tmpDir, 'doc.md'), '<!-- old -->');
      fs.writeFileSync(path.join(tmpDir, '.npmdata'), 'doc.md|pkg-a|1.0.0|0\n');

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // eslint-disable-next-line functional/no-let
      let capturedExitCode: number | undefined;
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
        capturedExitCode = code as number;
        throw Object.assign(new Error('process.exit'), { code });
      });

      expect(() => run(BIN_DIR, ['node', 'script.js', 'check', '--output', tmpDir])).toThrow();

      expect(capturedExitCode).toBe(1);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('content-replacement out of sync'),
      );
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('does not throw when contentReplacements are already in sync', () => {
      mockReadFileSync.mockReturnValueOnce(
        Buffer.from(
          JSON.stringify({
            name: 'my-pkg',
            npmdata: {
              sets: [
                {
                  package: 'pkg-a',
                  outputDir: '.',
                  contentReplacements: [
                    { files: 'doc.md', match: '<!-- old -->', replace: '<!-- new -->' },
                  ],
                },
              ],
            },
          }),
        ),
      );
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      // File already has replacement applied – no diff expected
      fs.writeFileSync(path.join(tmpDir, 'doc.md'), '<!-- new -->');
      fs.writeFileSync(path.join(tmpDir, '.npmdata'), 'doc.md|pkg-a|1.0.0|0\n');

      expect(() => run(BIN_DIR, ['node', 'script.js', 'check', '--output', tmpDir])).not.toThrow();
    });
  });

  describe('run – list action', () => {
    it('runs a list command for each unique outputDir', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'list']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('list'))).toBe(true);
    });

    it('runs only one list command when multiple entries share the same outputDir', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './data' },
            { package: 'pkg-b', outputDir: './data' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'list']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('passes the resolved output dir in the list command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'list']);

      expect(capturedCommand()).toContain(`--output "${path.resolve('./data')}"`);
    });

    it('uses --output as base dir for resolving outputDir in list', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'list', '--output', '/custom/base']);

      expect(capturedCommand()).toContain(`--output "${path.resolve('/custom/base', 'data')}"`);
    });

    it('lists all entries regardless of tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
      });

      // Even with --tags, list should show all output dirs
      run(BIN_DIR, ['node', 'script.js', 'list', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('uses default entry when npmdata is absent', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, ['node', 'script.js', 'list']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('list');
    });
  });

  describe('run – purge action', () => {
    it('runs a purge command for each entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'purge']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('purge'))).toBe(true);
    });

    it('respects --tags when running purge', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'purge', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('pkg-a');
    });

    it('overlays --dry-run from argv onto the purge command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'purge', '--dry-run']);

      expect(capturedCommand()).toContain('--dry-run');
    });

    it('overlays --silent from argv onto the purge command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'purge', '--silent']);

      expect(capturedCommand()).toContain('--silent');
    });

    it('uses --output as base dir for resolving outputDir in purge', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: 'data' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'purge', '--output', '/custom/base']);

      expect(capturedCommand()).toContain(`--output "${path.resolve('/custom/base', 'data')}"`);
    });

    it('uses default entry when npmdata is absent', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, ['node', 'script.js', 'purge']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('purge');
      expect(capturedCommand()).toContain('--packages "my-pkg"');
    });
  });

  describe('run – purge action with symlinks', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      (fs.mkdirSync as jest.Mock).mockImplementation(
        jest.requireActual<typeof fs>('node:fs').mkdirSync,
      );
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-run-purge-sym-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('removes stale managed symlinks from target dirs after purge', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      fs.mkdirSync(path.join(outputDir, 'skills'), { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      // Dead managed symlink pointing into outputDir (simulates a previously extracted file)
      const staleSource = path.join(outputDir, 'skills', 'skill-OLD');
      fs.symlinkSync(staleSource, path.join(targetDir, 'skill-OLD'));

      mockReadFileSync.mockReturnValueOnce(
        Buffer.from(
          JSON.stringify({
            name: 'my-pkg',
            npmdata: {
              sets: [
                {
                  package: 'pkg-a',
                  outputDir: 'out',
                  symlinks: [{ source: 'skills/*', target: '.github/skills' }],
                },
              ],
            },
          }),
        ),
      );
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);

      run(BIN_DIR, ['node', 'script.js', 'purge', '--output', tmpDir]);

      const linkGone = ((): boolean => {
        // eslint-disable-next-line functional/no-try-statements
        try {
          fs.lstatSync(path.join(targetDir, 'skill-OLD'));
          return false;
        } catch {
          return true;
        }
      })();
      expect(linkGone).toBe(true);
    });

    it('does not remove symlinks when --dry-run is active', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      fs.mkdirSync(path.join(outputDir, 'skills'), { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      const staleSource = path.join(outputDir, 'skills', 'skill-OLD');
      fs.symlinkSync(staleSource, path.join(targetDir, 'skill-OLD'));

      mockReadFileSync.mockReturnValueOnce(
        Buffer.from(
          JSON.stringify({
            name: 'my-pkg',
            npmdata: {
              sets: [
                {
                  package: 'pkg-a',
                  outputDir: 'out',
                  symlinks: [{ source: 'skills/*', target: '.github/skills' }],
                },
              ],
            },
          }),
        ),
      );
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);

      run(BIN_DIR, ['node', 'script.js', 'purge', '--dry-run', '--output', tmpDir]);

      // Symlink must survive because dry-run skips applySymlinks
      expect(fs.lstatSync(path.join(targetDir, 'skill-OLD')).isSymbolicLink()).toBe(true);
    });
  });

  describe('run – extract --dry-run from argv', () => {
    it('adds --dry-run to the extract command when --dry-run is in argv', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--dry-run']);

      expect(capturedCommand()).toContain('--dry-run');
    });

    it('adds --silent to the extract command when --silent is in argv', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.' }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--silent']);

      expect(capturedCommand()).toContain('--silent');
    });

    it('merges argv --dry-run with entry dryRun:false (argv wins)', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', dryRun: false }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--dry-run']);

      expect(capturedCommand()).toContain('--dry-run');
    });

    it('keeps --dry-run when already set in entry config', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'my-pkg', outputDir: '.', dryRun: true }] },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract']);

      expect(capturedCommand()).toContain('--dry-run');
    });

    it('applies --dry-run overlay to all entries', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--dry-run']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('--dry-run'))).toBe(true);
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
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }] },
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
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
            { package: 'pkg-b', outputDir: './b', tags: ['staging', 'prod'] },
          ],
        },
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
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a' }] },
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('(none defined in package.json)');
      writeSpy.mockRestore();
    });
  });

  describe('run – default extract', () => {
    it('runs extract when no action is provided', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a' }] },
      });

      run(BIN_DIR, ['node', 'script.js']);

      expect(mockExecSync).toHaveBeenCalled();
      expect(capturedCommand()).toContain('extract');
    });

    it('runs extract when only flags are provided (no explicit action)', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a', tags: ['t1'] }] },
      });

      run(BIN_DIR, ['node', 'script.js', '--tags', 't1']);

      expect(mockExecSync).toHaveBeenCalled();
      expect(capturedCommand()).toContain('extract');
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
      // These tests need real filesystem; restore readFileSync and mkdirSync to the actual implementation.
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      (fs.mkdirSync as jest.Mock).mockImplementation(
        jest.requireActual<typeof fs>('node:fs').mkdirSync,
      );
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
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-b', 'guide.md'), '# Skill B');
      fs.writeFileSync(
        path.join(outputDir, '.npmdata'),
        'skills/skill-a/README.md|pkg|1.0.0|0\nskills/skill-b/guide.md|pkg|1.0.0|0\n',
      );

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
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');
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
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');
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
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');
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
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');

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

    it('logs A for created symlinks in git style', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      const expectedPath = path.join('.github', 'skills', 'skill-a');
      expect(logSpy).toHaveBeenCalledWith(`A\t${expectedPath}`);

      logSpy.mockRestore();
    });

    it('logs M for updated symlinks in git style', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');

      // Create the symlink pointing to a different path first so it will be "updated".
      const oldSource = path.join(outputDir, 'skills', 'old-target');
      fs.mkdirSync(oldSource, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });
      fs.symlinkSync(oldSource, path.join(targetDir, 'skill-a'));

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      const expectedPath = path.join('.github', 'skills', 'skill-a');
      expect(logSpy).toHaveBeenCalledWith(`M\t${expectedPath}`);

      logSpy.mockRestore();
    });

    it('logs D for removed stale symlinks in git style', () => {
      const outputDir = path.join(tmpDir, 'out');
      const targetDir = path.join(tmpDir, '.github', 'skills');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.writeFileSync(path.join(outputDir, '.npmdata'), '');
      fs.mkdirSync(targetDir, { recursive: true });

      const staleTarget = path.join(outputDir, 'skills', 'skill-OLD');
      fs.symlinkSync(staleTarget, path.join(targetDir, 'skill-OLD'));

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      const expectedPath = path.join('.github', 'skills', 'skill-OLD');
      expect(logSpy).toHaveBeenCalledWith(`D\t${expectedPath}`);

      logSpy.mockRestore();
    });

    it('does not log anything when silent is true', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(path.join(outputDir, 'skills', 'skill-a'), { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'skills', 'skill-a', 'README.md'), '');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'skills/skill-a/README.md|pkg|1.0.0|0\n');

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: 'out',
        silent: true,
        symlinks: [{ source: 'skills/*', target: '.github/skills' }],
      };

      applySymlinks(entry, tmpDir);

      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  // ─── applyContentReplacements ───────────────────────────────────────────────
  describe('applyContentReplacements', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      // These tests need real filesystem; restore readFileSync and mkdirSync to the actual implementation.
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      (fs.mkdirSync as jest.Mock).mockImplementation(
        jest.requireActual<typeof fs>('node:fs').mkdirSync,
      );
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
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
      fs.writeFileSync(
        path.join(outputDir, 'docs', 'README.md'),
        '# Title\n<!-- version: 0.0.0 -->\nBody',
      );
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'docs/README.md|pkg|1.0.0|0\n');

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

      const updated = fs.readFileSync(path.join(outputDir, 'docs', 'README.md'), 'utf8');
      expect(updated).toContain('<!-- version: 1.2.3 -->');
      expect(updated).not.toContain('<!-- version: 0.0.0 -->');
    });

    it('replaces all occurrences across multiple files', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'a.md'), 'TOKEN');
      fs.writeFileSync(path.join(outputDir, 'b.md'), 'TOKEN and TOKEN');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'a.md|pkg|1.0.0|0\nb.md|pkg|1.0.0|0\n');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: 'TOKEN', replace: 'REPLACED' }],
      };

      applyContentReplacements(entry, tmpDir);

      expect(fs.readFileSync(path.join(outputDir, 'a.md'), 'utf8')).toBe('REPLACED');
      expect(fs.readFileSync(path.join(outputDir, 'b.md'), 'utf8')).toBe('REPLACED and REPLACED');
    });

    it('does not write a file when content does not change', () => {
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, 'no-match.md');
      fs.writeFileSync(filePath, 'nothing to replace here');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'no-match.md|pkg|1.0.0|0\n');
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
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'ref.md'), 'hello world');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'ref.md|pkg|1.0.0|0\n');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: '(hello) (world)', replace: '$2 $1' }],
      };

      applyContentReplacements(entry, tmpDir);

      expect(fs.readFileSync(path.join(outputDir, 'ref.md'), 'utf8')).toBe('world hello');
    });
  });

  // ─── checkContentReplacements ───────────────────────────────────────────────
  describe('checkContentReplacements', () => {
    // eslint-disable-next-line functional/no-let
    let tmpDir: string;

    beforeEach(() => {
      // These tests need real filesystem; restore readFileSync and mkdirSync to the actual implementation.
      mockReadFileSync.mockImplementation(jest.requireActual<typeof fs>('node:fs').readFileSync);
      (fs.mkdirSync as jest.Mock).mockImplementation(
        jest.requireActual<typeof fs>('node:fs').mkdirSync,
      );
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
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'doc.md'), '<!-- version: 1.2.3 -->');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'doc.md|pkg|1.0.0|0\n');

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
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, 'doc.md');
      fs.writeFileSync(filePath, '<!-- version: 0.0.0 -->');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'doc.md|pkg|1.0.0|0\n');

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
      const outputDir = path.join(tmpDir, 'out');
      fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, 'up-to-date.md');
      fs.writeFileSync(filePath, 'no marker here');
      fs.writeFileSync(path.join(outputDir, '.npmdata'), 'up-to-date.md|pkg|1.0.0|0\n');

      const entry: NpmdataExtractEntry = {
        package: 'pkg',
        outputDir: './out',
        contentReplacements: [{ files: '*.md', match: 'MARKER', replace: 'REPLACED' }],
      };

      const outOfSync = checkContentReplacements(entry, tmpDir);
      expect(outOfSync).not.toContain(filePath);
    });
  });

  describe('run – output formatting: blank lines and totals', () => {
    it('writes a blank line between entries for extract', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, EXTRACT_ARGV);

      const written = stdoutSpy.mock.calls.map((c) => c[0] as string);
      expect(written).toContain('\n');
      stdoutSpy.mockRestore();
    });

    it('writes "Total extracted" after multiple extract entries', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      mockExecSync.mockReturnValue(
        'Extraction complete: 2 added, 0 modified, 0 deleted, 0 skipped',
      );
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, EXTRACT_ARGV);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('Total extracted: 4 added, 0 modified, 0 deleted, 0 skipped');
      stdoutSpy.mockRestore();
    });

    it('does not write "Total extracted" for a single extract entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a' }] },
      });
      mockExecSync.mockReturnValue(
        'Extraction complete: 2 added, 0 modified, 0 deleted, 0 skipped',
      );
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, EXTRACT_ARGV);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).not.toContain('Total extracted:');
      stdoutSpy.mockRestore();
    });

    it('writes a blank line between entries for purge', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'purge']);

      const written = stdoutSpy.mock.calls.map((c) => c[0] as string);
      expect(written).toContain('\n');
      stdoutSpy.mockRestore();
    });

    it('writes "Total purged" accumulating counts from multiple purge entries', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      mockExecSync.mockReturnValue('Purge complete: 3 deleted');
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'purge']);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('Total purged: 6');
      stdoutSpy.mockRestore();
    });

    it('does not write "Total purged" for a single purge entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a' }] },
      });
      mockExecSync.mockReturnValue('Purge complete: 3 deleted');
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'purge']);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).not.toContain('Total purged:');
      stdoutSpy.mockRestore();
    });

    it('does not write "Total purged" when --silent is set', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      mockExecSync.mockReturnValue('Purge complete: 3 deleted');
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'purge', '--silent']);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).not.toContain('Total purged:');
      stdoutSpy.mockRestore();
    });

    it('writes a blank line between entries for check', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'check']);

      const written = stdoutSpy.mock.calls.map((c) => c[0] as string);
      expect(written).toContain('\n');
      stdoutSpy.mockRestore();
    });

    it('writes "Total checked" after multiple check entries', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [
            { package: 'pkg-a', outputDir: './a' },
            { package: 'pkg-b', outputDir: './b' },
          ],
        },
      });
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'check']);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).toContain('Total checked: 2 packages');
      stdoutSpy.mockRestore();
    });

    it('does not write "Total checked" for a single check entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: { sets: [{ package: 'pkg-a', outputDir: './a' }] },
      });
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'check']);

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(allOutput).not.toContain('Total checked:');
      stdoutSpy.mockRestore();
    });
  });

  describe('runEntries', () => {
    const CLI_PATH = '/fake/npmdata/dist/main.js';
    const entries: NpmdataExtractEntry[] = [
      { package: 'pkg-a', outputDir: './a' },
      { package: 'pkg-b', outputDir: './b' },
    ];

    it('invokes execSync once per entry for extract action', () => {
      runEntries(entries, 'extract', ['node', 'script.js', 'extract'], CLI_PATH);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      expect(capturedCommands()[0]).toContain('--packages "pkg-a"');
      expect(capturedCommands()[1]).toContain('--packages "pkg-b"');
    });

    it('invokes execSync for check action', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockExecSync.mockReturnValue(Buffer.from('All files are in sync\n') as any);

      runEntries(
        [{ package: 'pkg-a', outputDir: './a' }],
        'check',
        ['node', 'script.js', 'check'],
        CLI_PATH,
      );

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('check');
      expect(capturedCommand()).toContain('--packages "pkg-a"');
    });

    it('invokes execSync for purge action', () => {
      // Return a string (not Buffer) because runPurge calls .match() on the captured stdout.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockExecSync.mockReturnValue('Purge complete: 0 deleted\n' as any);

      runEntries(
        [{ package: 'pkg-a', outputDir: './a' }],
        'purge',
        ['node', 'script.js', 'purge'],
        CLI_PATH,
      );

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('purge');
      expect(capturedCommand()).toContain('"pkg-a"');
    });

    it('uses the provided cliPath in the generated command', () => {
      runEntries(
        [{ package: 'pkg-a', outputDir: '.' }],
        'extract',
        ['node', 'script.js', 'extract'],
        CLI_PATH,
      );

      expect(capturedCommand()).toContain(CLI_PATH);
    });

    it('filters entries by --tags when provided in argv', () => {
      const taggedEntries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['docs'] },
        { package: 'pkg-b', outputDir: './b', tags: ['data'] },
      ];

      runEntries(
        taggedEntries,
        'extract',
        ['node', 'script.js', 'extract', '--tags', 'docs'],
        CLI_PATH,
      );

      // Only pkg-a should be extracted; pkg-b gets purged (tag-excluded)
      const commands = capturedCommands();
      expect(commands.some((c) => c.includes('--packages "pkg-a"') && c.includes('extract'))).toBe(
        true,
      );
      expect(commands.some((c) => c.includes('--packages "pkg-b"') && c.includes('purge'))).toBe(
        true,
      );
    });

    it('calls process.exit when a sub-command fails', () => {
      const exitError = Object.assign(new Error('failed'), { status: 3 });
      mockExecSync.mockImplementation(() => {
        throw exitError;
      });

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      expect(() =>
        runEntries(
          [{ package: 'pkg-a', outputDir: '.' }],
          'extract',
          ['node', 'script.js', 'extract'],
          CLI_PATH,
        ),
      ).toThrow('process.exit called');

      expect(mockExit).toHaveBeenCalledWith(3);
      mockExit.mockRestore();
    });
  });

  describe('run – postExtractScript config', () => {
    it('runs postExtractScript after extract when defined in npmdata config', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.' }],
          postExtractScript: 'node postExtract.js',
        },
      });

      run(BIN_DIR, EXTRACT_ARGV);

      const commands = capturedCommands();
      const postExtractCall = commands.at(-1);
      expect(postExtractCall).toContain('node postExtract.js');
    });

    it('passes user args to the postExtractScript', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.' }],
          postExtractScript: 'node postExtract.js',
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--verbose', '--output', '/some/dir']);

      const commands = capturedCommands();
      const postExtractCall = commands.at(-1);
      expect(postExtractCall).toContain('node postExtract.js');
      expect(postExtractCall).toContain('extract');
      expect(postExtractCall).toContain('--verbose');
      expect(postExtractCall).toContain('--output');
      expect(postExtractCall).toContain('/some/dir');
    });

    it('does not run postExtractScript when it is not defined in config', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      // Only one call for the extract itself; no postExtract call
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('does not run postExtractScript during dry-run', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.' }],
          postExtractScript: 'node postExtract.js',
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--dry-run']);

      const commands = capturedCommands();
      expect(commands.every((c) => !c.includes('postExtract.js'))).toBe(true);
    });

    it('does not run postExtractScript for non-extract actions', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.' }],
          postExtractScript: 'node postExtract.js',
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'check']);

      const commands = capturedCommands();
      expect(commands.every((c) => !c.includes('postExtract.js'))).toBe(true);
    });

    it('runs postExtractScript with cwd resolved from --output flag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.' }],
          postExtractScript: 'node postExtract.js',
        },
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--output', '/custom/base']);

      const { calls } = mockExecSync.mock;
      const lastCall = calls.at(-1);
      expect(lastCall).toBeDefined();
      const lastCallOptions = lastCall![1] as { cwd?: string };
      expect(lastCallOptions.cwd).toBe('/custom/base');
    });

    it('propagates exit code when postExtractScript fails', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: {
          sets: [{ package: 'my-pkg', outputDir: '.' }],
          postExtractScript: 'node postExtract.js',
        },
      });
      // First call (extract) succeeds (default mock returns undefined),
      // second call (postExtract) throws with a non-zero exit code.
      mockExecSync
        .mockImplementationOnce(() => undefined as unknown as ReturnType<typeof execSync>)
        .mockImplementationOnce(() => {
          throw Object.assign(new Error('postExtract failed'), { status: 5 });
        });

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      expect(() => run(BIN_DIR, EXTRACT_ARGV)).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(5);
      mockExit.mockRestore();
    });
  });

  describe('runEntries \u2013 postExtractScript', () => {
    const CLI_PATH = '/fake/npmdata/dist/main.js';
    const entries: NpmdataExtractEntry[] = [{ package: 'pkg-a', outputDir: './a' }];

    it('runs postExtractScript after extract when provided', () => {
      runEntries(entries, 'extract', ['node', 'script.js', 'extract'], CLI_PATH, 'node post.js');

      const commands = capturedCommands();
      expect(commands.some((c) => c.includes('node post.js'))).toBe(true);
    });

    it('passes user args to postExtractScript', () => {
      runEntries(
        entries,
        'extract',
        ['node', 'script.js', 'extract', '--verbose'],
        CLI_PATH,
        'node post.js',
      );

      const commands = capturedCommands();
      const postCall = commands.at(-1);
      expect(postCall).toContain('node post.js');
      expect(postCall).toContain('--verbose');
    });

    it('does not run postExtractScript when not provided', () => {
      runEntries(entries, 'extract', ['node', 'script.js', 'extract'], CLI_PATH);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('does not run postExtractScript during dry-run', () => {
      runEntries(
        entries,
        'extract',
        ['node', 'script.js', 'extract', '--dry-run'],
        CLI_PATH,
        'node post.js',
      );

      const commands = capturedCommands();
      expect(commands.every((c) => !c.includes('node post.js'))).toBe(true);
    });

    it('does not run postExtractScript for non-extract actions', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockExecSync.mockReturnValue('Purge complete: 0 deleted\n' as any);

      runEntries(entries, 'purge', ['node', 'script.js', 'purge'], CLI_PATH, 'node post.js');

      const commands = capturedCommands();
      expect(commands.every((c) => !c.includes('node post.js'))).toBe(true);
    });
  });
});
