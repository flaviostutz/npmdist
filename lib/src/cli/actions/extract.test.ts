/* eslint-disable unicorn/no-null */
/* eslint-disable no-console */
import childProcess from 'node:child_process';

import { actionExtract } from '../../package/action-extract';
import { NpmdataConfig, ProgressEvent } from '../../types';
import { printUsage } from '../usage';

import { runExtract } from './extract';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('node:child_process', () => ({ execSync: jest.fn() }));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;
const mockExecSync = childProcess.execSync as jest.MockedFunction<typeof childProcess.execSync>;

jest.mock('../../package/action-extract', () => ({
  actionExtract: jest.fn(),
}));
const mockActionExtract = actionExtract as jest.MockedFunction<typeof actionExtract>;

const DEFAULT_RESULT = { added: 1, modified: 0, deleted: 0, skipped: 0 };

const CONFIG_WITH_SETS: NpmdataConfig = {
  sets: [
    {
      package: 'config-pkg@1.0.0',
      output: { path: './config-out', force: false, gitignore: true },
      selector: {},
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionExtract.mockResolvedValue(DEFAULT_RESULT);
});

afterEach(() => {
  delete process.exitCode;
});

describe('runExtract — source selection', () => {
  it('uses CLI --packages entries when provided, ignoring config sets', async () => {
    await runExtract(
      CONFIG_WITH_SETS,
      ['--packages', 'cli-pkg@2.0.0', '--output', './cli-out', '--no-gitignore'],
      '/cwd',
    );
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('cli-pkg@2.0.0');
    expect(entries[0].output.path).toBe('./cli-out');
  });

  it('uses config sets when --packages is not provided', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('config-pkg@1.0.0');
  });

  it('throws when no --packages and config is null', async () => {
    await expect(runExtract(null, [], '/cwd')).rejects.toThrow('No packages specified');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });

  it('throws when no --packages and config has empty sets', async () => {
    await expect(runExtract({ sets: [] }, [], '/cwd')).rejects.toThrow('No packages specified');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });

  it('passes multiple config sets when defined', async () => {
    const multiConfig: NpmdataConfig = {
      sets: [
        { package: 'pkg-a@1.0.0', output: { path: './a' } },
        { package: 'pkg-b@2.0.0', output: { path: './b' } },
      ],
    };
    await runExtract(multiConfig, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries[0].package).toBe('pkg-a@1.0.0');
    expect(entries[1].package).toBe('pkg-b@2.0.0');
  });
});

describe('runExtract — CLI overrides applied to config entries', () => {
  it('overrides output path with --output', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--output', './override-out'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.path).toBe('./override-out');
  });

  it('overrides force with --force', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--force'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.force).toBe(true);
  });

  it('overrides dryRun with --dry-run', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--dry-run'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.dryRun).toBe(true);
  });

  it('overrides gitignore with --no-gitignore', async () => {
    // Config entry has gitignore: true — CLI flag should override to false
    await runExtract(CONFIG_WITH_SETS, ['--no-gitignore'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.gitignore).toBe(false);
  });

  it('overrides keepExisting with --keep-existing', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--keep-existing'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.keepExisting).toBe(true);
  });

  it('overrides silent with --silent', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--silent'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].silent).toBe(true);
  });

  it('preserves config entry values when no overriding CLI flag given', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.path).toBe('./config-out');
    expect(entries[0].output.force).toBe(false);
    expect(entries[0].output.gitignore).toBe(true);
  });

  it('applies CLI overrides to all config entries', async () => {
    const multiConfig: NpmdataConfig = {
      sets: [
        { package: 'pkg-a@1.0.0', output: { path: './a' } },
        { package: 'pkg-b@2.0.0', output: { path: './b' } },
      ],
    };
    await runExtract(multiConfig, ['--dry-run', '--silent'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.dryRun).toBe(true);
    expect(entries[0].silent).toBe(true);
    expect(entries[1].output.dryRun).toBe(true);
    expect(entries[1].silent).toBe(true);
  });
});

describe('runExtract — CLI --packages does not apply applyArgvOverrides redundantly', () => {
  it('embeds CLI flags directly in entries built from --packages', async () => {
    // When --packages is used, flags are already baked in by buildEntriesFromArgv
    await runExtract(
      null,
      ['--packages', 'cli-pkg', '--force', '--dry-run', '--silent', '--no-gitignore'],
      '/cwd',
    );
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output.force).toBe(true);
    expect(entries[0].output.dryRun).toBe(true);
    expect(entries[0].output.gitignore).toBe(false);
    expect(entries[0].silent).toBe(true);
  });
});

describe('runExtract — preset filtering', () => {
  const configWithPresets: NpmdataConfig = {
    sets: [
      { package: 'pkg-docs@1.0.0', output: { path: '.' }, selector: { presets: ['docs'] } },
      { package: 'pkg-api@1.0.0', output: { path: '.' }, selector: { presets: ['api'] } },
    ],
  };

  it('passes all config entries when no presets specified', async () => {
    await runExtract(configWithPresets, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(2);
  });

  it('filters config entries to matching preset', async () => {
    await runExtract(configWithPresets, ['--presets', 'docs'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('pkg-docs@1.0.0');
  });

  it('does not call actionExtract when no entries match preset', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runExtract(configWithPresets, ['--presets', 'nonexistent'], '/cwd');
    spy.mockRestore();
    expect(mockActionExtract).not.toHaveBeenCalled();
  });
});

describe('runExtract — error handling', () => {
  it('throws on invalid argv and skips actionExtract', async () => {
    await expect(
      runExtract(CONFIG_WITH_SETS, ['--force', '--keep-existing'], '/cwd'),
    ).rejects.toThrow('--force and --keep-existing are mutually exclusive');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });

  it('propagates error when actionExtract throws', async () => {
    mockActionExtract.mockRejectedValue(new Error('extract failed'));
    await expect(runExtract(CONFIG_WITH_SETS, [], '/cwd')).rejects.toThrow('extract failed');
  });
});

describe('runExtract — --help', () => {
  it('prints usage and returns without calling actionExtract', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--help'], '/cwd');
    expect(mockPrintUsage).toHaveBeenCalledWith('extract');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });
});

describe('runExtract — summary output', () => {
  it('prints correct summary line after successful extract', async () => {
    mockActionExtract.mockResolvedValue({ added: 3, modified: 1, deleted: 2, skipped: 4 });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    expect(spy).toHaveBeenCalledWith(
      'Extract complete: 3 added, 1 modified, 2 deleted, 4 skipped.',
    );
    spy.mockRestore();
  });

  it('passes cwd and config through to actionExtract', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/my/cwd');
    const callArg = mockActionExtract.mock.calls[0][0];
    expect(callArg.cwd).toBe('/my/cwd');
    expect(callArg.config).toBe(CONFIG_WITH_SETS);
  });
});

describe('runExtract — onProgress handler', () => {
  // Helper: capture onProgress, call it with a fake event, check console output
  const runWithEvent = async (event: ProgressEvent, silent = false): Promise<string[]> => {
    let capturedOnProgress: ((e: ProgressEvent) => void) | undefined;
    mockActionExtract.mockImplementation(async ({ onProgress }) => {
      capturedOnProgress = onProgress;
      return DEFAULT_RESULT;
    });

    const config: NpmdataConfig = {
      sets: [{ package: 'pkg@1.0.0', output: { path: '.' }, silent }],
    };
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await runExtract(config, [], '/cwd');
    capturedOnProgress!(event);
    spy.mockRestore();
    return logs;
  };

  it('logs file-added event with + prefix', async () => {
    const logs = await runWithEvent({ type: 'file-added', packageName: 'pkg', file: 'docs/a.md' });
    expect(logs.includes('  + docs/a.md')).toBe(true);
  });

  it('logs file-modified event with ~ prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-modified',
      packageName: 'pkg',
      file: 'docs/b.md',
    });
    expect(logs.includes('  ~ docs/b.md')).toBe(true);
  });

  it('logs file-deleted event with - prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-deleted',
      packageName: 'pkg',
      file: 'docs/c.md',
    });
    expect(logs.includes('  - docs/c.md')).toBe(true);
  });

  it('suppresses progress output when entry is silent', async () => {
    const logs = await runWithEvent({ type: 'file-added', packageName: 'pkg', file: 'x.md' }, true);
    // Only the summary line should appear, not a progress line
    expect(logs.every((l) => !l.startsWith('  +'))).toBe(true);
  });

  it('ignores file-skipped events (no log)', async () => {
    const logs = await runWithEvent({
      type: 'file-skipped',
      packageName: 'pkg',
      file: 'docs/d.md',
    });
    expect(logs.every((l) => !l.includes('docs/d.md'))).toBe(true);
  });
});

describe('runExtract — postExtractScript', () => {
  const configWithScript: NpmdataConfig = {
    sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
    postExtractScript: 'echo done',
  };

  it('runs postExtractScript after successful non-dry-run extract', async () => {
    await runExtract(configWithScript, [], '/cwd');
    expect(mockExecSync).toHaveBeenCalledWith('echo done', {
      cwd: '/cwd',
      stdio: 'inherit',
      encoding: 'utf8',
    });
  });

  it('appends argv to the postExtractScript command', async () => {
    await runExtract(configWithScript, ['--silent'], '/cwd');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--silent'),
      expect.any(Object),
    );
  });

  it('does not run postExtractScript when --dry-run', async () => {
    await runExtract(configWithScript, ['--dry-run'], '/cwd');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('does not run postExtractScript when config has no script', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('throws with script exit code in message on script failure', async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error('script failed') as Error & { status: number };
      err.status = 42;
      throw err;
    });
    await expect(runExtract(configWithScript, [], '/cwd')).rejects.toThrow(
      'Post-extract script failed with exit code 42',
    );
  });

  it('throws with exit code 1 when script fails with no status code', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('script crashed');
    });
    await expect(runExtract(configWithScript, [], '/cwd')).rejects.toThrow(
      'Post-extract script failed with exit code 1',
    );
  });

  it('does not print summary after script failure', async () => {
    mockExecSync.mockImplementation(() => {
      throw Object.assign(new Error('fail'), { status: 2 });
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runExtract(configWithScript, [], '/cwd')).rejects.toThrow();
    spy.mockRestore();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Extract complete'));
  });
});
