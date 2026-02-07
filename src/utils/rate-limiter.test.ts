import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock setInterval before importing the module
vi.useFakeTimers();

// Dynamic import to get a fresh module for each test suite
let checkAdminRateLimit: (operation: string) => boolean;
let stopRateLimiterCleanup: () => void;
let ADMIN_RATE_LIMIT: number;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./rate-limiter.js');
  checkAdminRateLimit = mod.checkAdminRateLimit;
  stopRateLimiterCleanup = mod.stopRateLimiterCleanup;
  ADMIN_RATE_LIMIT = mod.ADMIN_RATE_LIMIT;
});

afterEach(() => {
  stopRateLimiterCleanup();
  vi.restoreAllMocks();
});

describe('checkAdminRateLimit', () => {
  it('allows requests under the limit', () => {
    expect(checkAdminRateLimit('testOp')).toBe(true);
    expect(checkAdminRateLimit('testOp')).toBe(true);
  });

  it('blocks requests at the limit', () => {
    for (let i = 0; i < ADMIN_RATE_LIMIT; i++) {
      expect(checkAdminRateLimit('testOp')).toBe(true);
    }
    expect(checkAdminRateLimit('testOp')).toBe(false);
  });

  it('tracks operations independently', () => {
    for (let i = 0; i < ADMIN_RATE_LIMIT; i++) {
      checkAdminRateLimit('op1');
    }
    expect(checkAdminRateLimit('op1')).toBe(false);
    expect(checkAdminRateLimit('op2')).toBe(true);
  });

  it('resets after the time window elapses', () => {
    for (let i = 0; i < ADMIN_RATE_LIMIT; i++) {
      checkAdminRateLimit('testOp');
    }
    expect(checkAdminRateLimit('testOp')).toBe(false);

    // Advance past the 1-minute window
    vi.advanceTimersByTime(61000);

    expect(checkAdminRateLimit('testOp')).toBe(true);
  });

  it('exports ADMIN_RATE_LIMIT as 100', () => {
    expect(ADMIN_RATE_LIMIT).toBe(100);
  });
});
