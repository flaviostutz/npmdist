/* eslint-disable unicorn/no-null */
/* eslint-disable no-console */
import path from 'node:path';

import { actionInit } from '../../package/action-init';
import { printUsage } from '../usage';

import { runInit } from './init';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('../../package/action-init', () => ({
  actionInit: jest.fn(),
}));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;
const mockActionInit = actionInit as jest.MockedFunction<typeof actionInit>;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionInit.mockResolvedValue();
});

afterEach(() => {
  delete process.exitCode;
});

describe('runInit — --help', () => {
  it('prints usage and returns without calling actionInit', async () => {
    await runInit(null, ['--help'], '/cwd');
    expect(mockPrintUsage).toHaveBeenCalledWith('init');
    expect(mockActionInit).not.toHaveBeenCalled();
  });
});

describe('runInit — output directory resolution', () => {
  it('uses resolved --output path as outputDir', async () => {
    await runInit(null, ['--output', 'my-pkg'], '/cwd');
    const expectedDir = path.resolve('/cwd', 'my-pkg');
    expect(mockActionInit).toHaveBeenCalledWith(expectedDir, false, expect.any(Object));
  });

  it('defaults to cwd when --output is not given', async () => {
    await runInit(null, [], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith('/cwd', false, expect.any(Object));
  });

  it('resolves absolute --output path without prepending cwd', async () => {
    await runInit(null, ['--output', '/absolute/path'], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith('/absolute/path', false, expect.any(Object));
  });
});

describe('runInit — verbose flag', () => {
  it('passes verbose=true when --verbose flag given', async () => {
    await runInit(null, ['--verbose'], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith('/cwd', true, expect.any(Object));
  });

  it('passes verbose=true when -v flag given', async () => {
    await runInit(null, ['-v'], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith('/cwd', true, expect.any(Object));
  });

  it('passes verbose=false when no verbose flag', async () => {
    await runInit(null, [], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith('/cwd', false, expect.any(Object));
  });
});

describe('runInit — --files and --packages forwarding', () => {
  it('forwards --files to initConfig.files', async () => {
    await runInit(null, ['--files', 'docs/**,data/**'], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith(
      '/cwd',
      false,
      expect.objectContaining({ files: ['docs/**', 'data/**'] }),
    );
  });

  it('forwards --packages to initConfig.packages as spec strings', async () => {
    await runInit(null, ['--packages', 'eslint@8'], '/cwd');
    expect(mockActionInit).toHaveBeenCalledWith(
      '/cwd',
      false,
      expect.objectContaining({ packages: ['eslint@8'] }),
    );
  });
});

describe('runInit — success output', () => {
  it('logs success message after actionInit completes', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runInit(null, [], '/cwd');
    spy.mockRestore();
    expect(logs.some((l) => l.includes('Init complete'))).toBe(true);
  });

  it('does not set exitCode on success', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runInit(null, [], '/cwd');
    spy.mockRestore();
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runInit — error handling', () => {
  it('propagates error when actionInit throws', async () => {
    mockActionInit.mockRejectedValue(new Error('init failed'));
    await expect(runInit(null, [], '/cwd')).rejects.toThrow('init failed');
  });

  it('propagates error message when actionInit throws', async () => {
    mockActionInit.mockRejectedValue(new Error('target already has package.json'));
    await expect(runInit(null, [], '/cwd')).rejects.toThrow('target already has package.json');
  });
});
