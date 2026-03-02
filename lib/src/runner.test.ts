import { execSync } from 'node:child_process';
import fs from 'node:fs';

import { run, parseTagsFromArgv, filterEntriesByTags } from './runner';
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

/** Capture the command string passed to execSync for the first call. */
function capturedCommand(): string {
  return mockExecSync.mock.calls[0][0] as string;
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

      run(BIN_DIR);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
      expect(capturedCommand()).toContain('--output "."');
    });

    it('uses a single default entry when npmdata is an empty array', () => {
      setupPackageJson({ name: 'my-pkg', npmdata: [] });

      run(BIN_DIR);

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

      run(BIN_DIR);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('passes stdio:inherit to execSync', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR);

      expect(mockExecSync).toHaveBeenCalledWith(expect.any(String), { stdio: 'inherit' });
    });

    it('resolves the CLI path and embeds it in the command', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR);

      // The command must call node with an absolute path to main.js and invoke extract.
      expect(capturedCommand()).toMatch(/node ".+main\.js"/);
      expect(capturedCommand()).toContain('extract');
    });

    it('propagates errors thrown by execSync', () => {
      setupPackageJson({ name: 'my-pkg' });
      mockExecSync.mockImplementation(() => {
        throw new Error('command failed');
      });

      expect(() => run(BIN_DIR)).toThrow('command failed');
    });
  });

  describe('buildExtractCommand – flag assembly', () => {
    it('builds a minimal command with only required fields', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: './out' }],
      });

      run(BIN_DIR);

      const cmd = capturedCommand();
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).toContain('--output "./out"');
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

      run(BIN_DIR);

      expect(capturedCommand()).toContain(' --force');
    });

    it('omits --force when force is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', force: false }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).not.toContain('--force');
    });

    it('omits --no-gitignore when gitignore is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', gitignore: true }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).not.toContain('--no-gitignore');
    });

    it('adds --no-gitignore when gitignore is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', gitignore: false }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain(' --no-gitignore');
    });

    it('adds --silent when silent is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', silent: true }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain(' --silent');
    });

    it('adds --dry-run when dryRun is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', dryRun: true }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain(' --dry-run');
    });

    it('adds --upgrade when upgrade is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', upgrade: true }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain(' --upgrade');
    });

    it('adds --unmanaged when unmanaged is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', unmanaged: true }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain(' --unmanaged');
    });

    it('omits --unmanaged when unmanaged is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', unmanaged: false }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).not.toContain('--unmanaged');
    });

    it('adds --files with a single file pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md'] }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain('--files "**/*.md"');
    });

    it('joins multiple file patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md', 'data/**'] }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain('--files "**/*.md,data/**"');
    });

    it('omits --files when files array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: [] }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).not.toContain('--files');
    });

    it('adds --content-regex with a single regex pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar'] }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar"');
    });

    it('joins multiple content regex patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar', '^baz'] }],
      });

      run(BIN_DIR);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar,^baz"');
    });

    it('omits --content-regex when contentRegexes array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: [] }],
      });

      run(BIN_DIR);

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

      run(BIN_DIR);

      const cmd = capturedCommand();
      expect(cmd).toContain('--packages "full-pkg@^2.0.0"');
      expect(cmd).toContain('--output "./data"');
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

      run(BIN_DIR);

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

      run(BIN_DIR, ['node', 'script.js']);

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

      run(BIN_DIR, ['node', 'script.js', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "pkg-a"');
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

      run(BIN_DIR, ['node', 'script.js', '--tags', 'prod,staging']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('runs no entries when no entry matches the requested tag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['dev'] }],
      });

      run(BIN_DIR, ['node', 'script.js', '--tags', 'prod']);

      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('skips entries without tags when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a' },
          { package: 'pkg-b', outputDir: './b', tags: ['prod'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "pkg-b"');
    });

    it('does not pass --tags to the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }],
      });

      run(BIN_DIR, ['node', 'script.js', '--tags', 'prod']);

      expect(capturedCommand()).not.toContain('--tags');
    });
  });
});
