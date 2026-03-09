/* eslint-disable unicorn/no-null */
/* eslint-disable no-console */
import { actionCheck } from '../../package/action-check';
import { NpmdataConfig } from '../../types';
import { printUsage } from '../usage';

import { runCheck } from './check';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('../../package/action-check', () => ({
  actionCheck: jest.fn(),
}));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;
const mockActionCheck = actionCheck as jest.MockedFunction<typeof actionCheck>;

const NO_DRIFT = { missing: [], modified: [], extra: [] };

const CONFIG: NpmdataConfig = {
  sets: [{ package: 'my-pkg@1.0.0', output: { path: './out', gitignore: false } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionCheck.mockResolvedValue(NO_DRIFT);
});

afterEach(() => {
  delete process.exitCode;
});

describe('runCheck — --help', () => {
  it('prints usage and returns without calling actionCheck', async () => {
    await runCheck(CONFIG, ['--help'], '/cwd');
    expect(mockPrintUsage).toHaveBeenCalledWith('check');
    expect(mockActionCheck).not.toHaveBeenCalled();
  });
});

describe('runCheck — config validation', () => {
  it('throws when config is null and no --packages given', async () => {
    await expect(runCheck(null, [], '/cwd')).rejects.toThrow('No packages specified');
    expect(mockActionCheck).not.toHaveBeenCalled();
  });

  it('throws when config has empty sets and no --packages given', async () => {
    await expect(runCheck({ sets: [] }, [], '/cwd')).rejects.toThrow('No packages specified');
    expect(mockActionCheck).not.toHaveBeenCalled();
  });

  it('calls actionCheck with entries from --packages when config is null', async () => {
    await runCheck(
      null,
      ['--packages', 'my-pkg@1.0.0', '--output', './out', '--no-gitignore'],
      '/cwd',
    );
    expect(mockActionCheck).toHaveBeenCalled();
    const callArg = mockActionCheck.mock.calls[0][0];
    expect(callArg.entries).toHaveLength(1);
    expect(callArg.entries[0].package).toBe('my-pkg@1.0.0');
  });
});

describe('runCheck — argv validation', () => {
  it('throws on invalid argv and skips actionCheck (--force + --keep-existing)', async () => {
    await expect(runCheck(CONFIG, ['--force', '--keep-existing'], '/cwd')).rejects.toThrow(
      '--force and --keep-existing are mutually exclusive',
    );
    expect(mockActionCheck).not.toHaveBeenCalled();
  });
});

describe('runCheck — no drift', () => {
  it('does not set exitCode when no drift found', async () => {
    mockActionCheck.mockResolvedValue(NO_DRIFT);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(process.exitCode).toBeUndefined();
  });

  it('prints "All managed files are in sync." when no drift', async () => {
    mockActionCheck.mockResolvedValue(NO_DRIFT);
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(logs).toContain('All managed files are in sync.');
  });
});

describe('runCheck — drift detected', () => {
  it('sets exitCode=1 when missing files found', async () => {
    mockActionCheck.mockResolvedValue({ missing: ['docs/a.md'], modified: [], extra: [] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
  });

  it('sets exitCode=1 when modified files found', async () => {
    mockActionCheck.mockResolvedValue({ missing: [], modified: ['docs/b.md'], extra: [] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
  });

  it('sets exitCode=1 when extra files found', async () => {
    mockActionCheck.mockResolvedValue({ missing: [], modified: [], extra: ['docs/c.md'] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
  });

  it('logs each missing file prefixed with "missing:"', async () => {
    mockActionCheck.mockResolvedValue({
      missing: ['docs/a.md', 'docs/b.md'],
      modified: [],
      extra: [],
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(logs).toContain('missing: docs/a.md');
    expect(logs).toContain('missing: docs/b.md');
  });

  it('logs each modified file prefixed with "modified:"', async () => {
    mockActionCheck.mockResolvedValue({
      missing: [],
      modified: ['docs/c.md'],
      extra: [],
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(logs).toContain('modified: docs/c.md');
  });

  it('logs each extra file prefixed with "extra:"', async () => {
    mockActionCheck.mockResolvedValue({
      missing: [],
      modified: [],
      extra: ['docs/d.md'],
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runCheck(CONFIG, [], '/cwd');
    spy.mockRestore();
    expect(logs).toContain('extra: docs/d.md');
  });
});

describe('runCheck — options forwarding', () => {
  it('passes cwd and config to actionCheck', async () => {
    await runCheck(CONFIG, [], '/my/cwd');
    const callArg = mockActionCheck.mock.calls[0][0];
    expect(callArg.cwd).toBe('/my/cwd');
    expect(callArg.config).toBe(CONFIG);
  });

  it('passes entries (config sets) to actionCheck', async () => {
    await runCheck(CONFIG, [], '/cwd');
    const callArg = mockActionCheck.mock.calls[0][0];
    expect(callArg.entries).toHaveLength(1);
    expect(callArg.entries[0].package).toBe('my-pkg@1.0.0');
  });

  it('passes verbose=true when --verbose flag given', async () => {
    await runCheck(CONFIG, ['--verbose'], '/cwd');
    expect(mockActionCheck.mock.calls[0][0].verbose).toBe(true);
  });

  it('passes skipUnmanaged=true when --unmanaged flag given', async () => {
    await runCheck(CONFIG, ['--unmanaged'], '/cwd');
    expect(mockActionCheck.mock.calls[0][0].skipUnmanaged).toBe(true);
  });
});

describe('runCheck — error handling', () => {
  it('propagates error when actionCheck throws', async () => {
    mockActionCheck.mockRejectedValue(new Error('check failed'));
    await expect(runCheck(CONFIG, [], '/cwd')).rejects.toThrow('check failed');
  });

  it('propagates error message when actionCheck throws', async () => {
    mockActionCheck.mockRejectedValue(new Error('something went wrong'));
    await expect(runCheck(CONFIG, [], '/cwd')).rejects.toThrow('something went wrong');
  });
});
