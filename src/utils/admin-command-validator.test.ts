import { describe, it, expect } from 'vitest';
import { validateAdminCommandParams, isWriteAdminCommand } from './admin-command-validator.js';

describe('validateAdminCommandParams', () => {
  it('allows valid listDatabases params', () => {
    const result = validateAdminCommandParams(
      { listDatabases: 1, nameOnly: true },
      'listDatabases'
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.sanitizedCommand).toEqual({ listDatabases: 1, nameOnly: true });
  });

  it('strips unknown parameters and warns', () => {
    const result = validateAdminCommandParams(
      { listDatabases: 1, evil: 'payload', nameOnly: true },
      'listDatabases'
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Stripped unknown parameter 'evil'");
    expect(result.sanitizedCommand).toEqual({ listDatabases: 1, nameOnly: true });
  });

  it('allows maxTimeMS for any command', () => {
    const result = validateAdminCommandParams(
      { ping: 1, maxTimeMS: 5000 },
      'ping'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ ping: 1, maxTimeMS: 5000 });
  });

  it('rejects deeply nested objects (depth > 2)', () => {
    const result = validateAdminCommandParams(
      { listDatabases: 1, filter: { a: { b: { c: { d: 1 } } } } },
      'listDatabases'
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes('deeply nested'))).toBe(true);
  });

  it('allows objects within depth limit', () => {
    const result = validateAdminCommandParams(
      { listDatabases: 1, filter: { name: { $regex: 'test' } } },
      'listDatabases'
    );
    expect(result.valid).toBe(true);
  });

  it('handles serverStatus command', () => {
    const result = validateAdminCommandParams(
      { serverStatus: 1 },
      'serverStatus'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ serverStatus: 1 });
  });

  it('handles profile command params', () => {
    const result = validateAdminCommandParams(
      { profile: 2, slowms: 100 },
      'profile'
    );
    expect(result.valid).toBe(true);
  });

  it('passes through unknown command names with depth check only', () => {
    const result = validateAdminCommandParams(
      { unknownCmd: 1, anyParam: 'value' },
      'unknownCmd'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ unknownCmd: 1, anyParam: 'value' });
  });

  it('case-insensitive command name matching', () => {
    const result = validateAdminCommandParams(
      { listDatabases: 1, evil: 'x' },
      'LISTDATABASES'
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts lowercase command keys like { dbstats: 1 }', () => {
    const result = validateAdminCommandParams(
      { dbstats: 1, scale: 1024 },
      'dbstats'
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.sanitizedCommand).toEqual({ dbstats: 1, scale: 1024 });
  });

  it('accepts lowercase serverstatus key', () => {
    const result = validateAdminCommandParams(
      { serverstatus: 1 },
      'serverstatus'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ serverstatus: 1 });
  });

  it('accepts lowercase replsetstatus key', () => {
    const result = validateAdminCommandParams(
      { replsetstatus: 1 },
      'replsetstatus'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ replsetstatus: 1 });
  });

  it('accepts lowercase shardingstatus key', () => {
    const result = validateAdminCommandParams(
      { shardingstatus: 1 },
      'shardingstatus'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ shardingstatus: 1 });
  });

  it('allows $in array filter without exceeding depth limit', () => {
    const result = validateAdminCommandParams(
      { listDatabases: 1, filter: { name: { $in: ['db1', 'db2', 'db3'] } } },
      'listdatabases'
    );
    expect(result.valid).toBe(true);
  });

  it('accepts uppercase command keys like { LISTDATABASES: 1 }', () => {
    const result = validateAdminCommandParams(
      { LISTDATABASES: 1 },
      'listdatabases'
    );
    expect(result.valid).toBe(true);
    expect(result.sanitizedCommand).toEqual({ LISTDATABASES: 1 });
  });
});

describe('isWriteAdminCommand', () => {
  describe('profile command', () => {
    it('is write when setting profiling level to 0', () => {
      expect(isWriteAdminCommand('profile', { profile: 0 })).toBe(true);
    });

    it('is write when setting profiling level to 1', () => {
      expect(isWriteAdminCommand('profile', { profile: 1 })).toBe(true);
    });

    it('is write when setting profiling level to 2', () => {
      expect(isWriteAdminCommand('profile', { profile: 2 })).toBe(true);
    });

    it('is write when setting slowms (modifies profiler config)', () => {
      expect(isWriteAdminCommand('profile', { profile: -1, slowms: 200 })).toBe(true);
    });

    it('is write when setting sampleRate (modifies profiler config)', () => {
      expect(isWriteAdminCommand('profile', { profile: -1, sampleRate: 0.5 })).toBe(true);
    });

    it('is read-only when querying profiler status (profile: -1)', () => {
      expect(isWriteAdminCommand('profile', { profile: -1 })).toBe(false);
    });

    it('is case-insensitive on command name', () => {
      expect(isWriteAdminCommand('PROFILE', { profile: 2 })).toBe(true);
      expect(isWriteAdminCommand('Profile', { profile: -1 })).toBe(false);
    });
  });

  describe('validate command', () => {
    it('is read-only without repair', () => {
      expect(isWriteAdminCommand('validate', { validate: 'myCollection' })).toBe(false);
    });

    it('is read-only with full: true (still read-only)', () => {
      expect(isWriteAdminCommand('validate', { validate: 'myCollection', full: true })).toBe(false);
    });

    it('is write when repair is true', () => {
      expect(isWriteAdminCommand('validate', { validate: 'myCollection', repair: true })).toBe(true);
    });

    it('is read-only when repair is false', () => {
      expect(isWriteAdminCommand('validate', { validate: 'myCollection', repair: false })).toBe(false);
    });

    it('handles case-insensitive repair key', () => {
      expect(isWriteAdminCommand('validate', { validate: 'myCollection', Repair: true } as any)).toBe(true);
      expect(isWriteAdminCommand('validate', { validate: 'myCollection', REPAIR: true } as any)).toBe(true);
    });

    it('is case-insensitive on command name', () => {
      expect(isWriteAdminCommand('VALIDATE', { validate: 'col', repair: true })).toBe(true);
      expect(isWriteAdminCommand('Validate', { validate: 'col' })).toBe(false);
    });
  });

  describe('other commands', () => {
    it('returns false for read-only commands', () => {
      expect(isWriteAdminCommand('ping', { ping: 1 })).toBe(false);
      expect(isWriteAdminCommand('serverStatus', { serverStatus: 1 })).toBe(false);
      expect(isWriteAdminCommand('dbStats', { dbStats: 1 })).toBe(false);
      expect(isWriteAdminCommand('listDatabases', { listDatabases: 1 })).toBe(false);
      expect(isWriteAdminCommand('currentOp', { currentOp: 1 })).toBe(false);
      expect(isWriteAdminCommand('getLog', { getLog: 'global' })).toBe(false);
    });
  });
});
