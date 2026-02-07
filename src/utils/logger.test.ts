import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock fs/promises before importing logger
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockRejectedValue(new Error('mock mkdir failure')),
    appendFile: vi.fn().mockRejectedValue(new Error('mock appendFile failure')),
  },
}));

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Set ENABLE_LOGGING so the logging paths execute
  process.env.ENABLE_LOGGING = 'true';
});

afterEach(() => {
  stderrSpy.mockRestore();
  delete process.env.ENABLE_LOGGING;
});

describe('logger stderr on failure', () => {
  it('writes to stderr when ensureLogDir mkdir fails', async () => {
    const { logToolUsage } = await import('./logger.js');

    logToolUsage('testTool', { foo: 'bar' });

    // Allow promises to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(stderrSpy).toHaveBeenCalled();
    const calls = (stderrSpy as Mock).mock.calls.flat().join('');
    expect(calls).toContain('[mongo-scout-mcp] logging failed:');
  });

  it('writes to stderr when appendFile fails in logError', async () => {
    // Re-mock mkdir to succeed so appendFile is reached
    const fsMod = await import('fs/promises');
    (fsMod.default.mkdir as Mock).mockResolvedValue(undefined);

    const { logError } = await import('./logger.js');

    // Suppress console.error from logError
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('testTool', new Error('test error'));
    consoleSpy.mockRestore();

    await new Promise((r) => setTimeout(r, 50));

    expect(stderrSpy).toHaveBeenCalled();
    const calls = (stderrSpy as Mock).mock.calls.flat().join('');
    expect(calls).toContain('[mongo-scout-mcp] logging failed:');
  });
});
