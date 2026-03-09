/* eslint-disable unicorn/no-null */
/* eslint-disable no-console */
import { actionPurge } from '../../package/action-purge';
import { NpmdataConfig, ProgressEvent } from '../../types';
import { printUsage } from '../usage';

import { runPurge } from './purge';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('../../package/action-purge', () => ({
  actionPurge: jest.fn(),
}));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;
const mockActionPurge = actionPurge as jest.MockedFunction<typeof actionPurge>;

const DEFAULT_RESULT = { deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 };

const CONFIG: NpmdataConfig = {
  sets: [{ package: 'my-pkg@1.0.0', output: { path: './out', gitignore: false } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionPurge.mockResolvedValue(DEFAULT_RESULT);
});

afterEach(() => {
  delete process.exitCode;
});

describe('runPurge — --help', () => {
  it('prints usage and returns without calling actionPurge', async () => {
    await runPurge(CONFIG, ['--help'], '/cwd');
    expect(mockPrintUsage).toHaveBeenCalledWith('purge');
    expect(mockActionPurge).not.toHaveBeenCalled();
  });
});

describe('runPurge — argv validation', () => {
  it('throws on invalid argv and skips actionPurge (--force + --keep-existing)', async () => {
    await expect(runPurge(CONFIG, ['--force', '--keep-existing'], '/cwd')).rejects.toThrow(
      '--force and --keep-existing are mutually exclusive',
    );
    expect(mockActionPurge).not.toHaveBeenCalled();
  });
});

describe('runPurge — summary output', () => {
  it('logs purge summary with deleted count', async () => {
    mockActionPurge.mockResolvedValue({ deleted: 5, symlinksRemoved: 2, dirsRemoved: 1 });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runPurge(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(logs.some((l) => l.includes('Purge complete') && l.includes('5 deleted'))).toBe(true);
  });

  it('does not set exitCode on success', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runPurge(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runPurge — options forwarding', () => {
  it('passes config sets as entries to actionPurge', async () => {
    await runPurge(CONFIG, [], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.entries).toHaveLength(1);
    expect(callArg.entries[0].package).toBe('my-pkg@1.0.0');
  });

  it('passes empty entries when config is null and no --packages given', async () => {
    await runPurge(null, [], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.entries).toEqual([]);
  });

  it('passes entries from --packages when config is null', async () => {
    await runPurge(null, ['--packages', 'my-pkg@1.0.0', '--output', './out'], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.entries).toHaveLength(1);
    expect(callArg.entries[0].package).toBe('my-pkg@1.0.0');
  });

  it('passes cwd and config to actionPurge', async () => {
    await runPurge(CONFIG, [], '/my/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.cwd).toBe('/my/cwd');
    expect(callArg.config).toBe(CONFIG);
  });

  it('passes --presets values to actionPurge', async () => {
    await runPurge(CONFIG, ['--presets', 'docs,api'], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.presets).toEqual(['docs', 'api']);
  });

  it('passes dryRun=true when --dry-run flag given', async () => {
    await runPurge(CONFIG, ['--dry-run'], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.dryRun).toBe(true);
  });

  it('passes verbose=true when --verbose flag given', async () => {
    await runPurge(CONFIG, ['--verbose'], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.verbose).toBe(true);
  });

  it('passes empty presets array when --presets not given', async () => {
    await runPurge(CONFIG, [], '/cwd');
    const callArg = mockActionPurge.mock.calls[0][0];
    expect(callArg.presets).toEqual([]);
  });
});

describe('runPurge — onProgress handler', () => {
  const runWithEvent = async (event: ProgressEvent, argv: string[] = []): Promise<string[]> => {
    let capturedOnProgress: ((e: ProgressEvent) => void) | undefined;
    mockActionPurge.mockImplementation(async ({ onProgress }) => {
      capturedOnProgress = onProgress;
      return DEFAULT_RESULT;
    });

    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await runPurge(CONFIG, argv, '/cwd');
    capturedOnProgress!(event);
    spy.mockRestore();
    return logs;
  };

  it('logs file-deleted event with - prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-deleted',
      packageName: 'my-pkg',
      file: 'docs/a.md',
    });
    expect(logs.includes('  - docs/a.md')).toBe(true);
  });

  it('suppresses progress output when --silent flag given', async () => {
    const logs = await runWithEvent(
      { type: 'file-deleted', packageName: 'my-pkg', file: 'docs/b.md' },
      ['--silent'],
    );
    expect(logs.every((l) => !l.startsWith('  -'))).toBe(true);
  });

  it('does not log for non-delete events', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'my-pkg',
      file: 'docs/c.md',
    });
    // only the summary line "Purge complete..." is expected, not a progress line
    expect(logs.every((l) => !l.includes('docs/c.md'))).toBe(true);
  });
});

describe('runPurge — error handling', () => {
  it('propagates error when actionPurge throws', async () => {
    mockActionPurge.mockRejectedValue(new Error('purge failed'));
    await expect(runPurge(CONFIG, [], '/cwd')).rejects.toThrow('purge failed');
  });

  it('propagates error message when actionPurge throws', async () => {
    mockActionPurge.mockRejectedValue(new Error('something went wrong'));
    await expect(runPurge(CONFIG, [], '/cwd')).rejects.toThrow('something went wrong');
  });
});
