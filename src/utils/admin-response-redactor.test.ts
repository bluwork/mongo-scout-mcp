import { describe, it, expect } from 'vitest';
import { redactAdminResponse } from './admin-response-redactor.js';

describe('redactAdminResponse', () => {
  describe('connectionStatus', () => {
    it('strips authenticatedUserPrivileges', () => {
      const response = {
        authInfo: {
          authenticatedUsers: [{ user: 'mongo', db: 'admin' }],
          authenticatedUserRoles: [{ role: 'root', db: 'admin' }],
          authenticatedUserPrivileges: [
            { resource: { db: '', collection: '' }, actions: ['find', 'insert'] },
          ],
        },
        ok: 1,
      };
      const result = redactAdminResponse('connectionstatus', response);
      expect(result.authInfo.authenticatedUserPrivileges).toBeUndefined();
    });

    it('strips authenticatedUserRoles', () => {
      const response = {
        authInfo: {
          authenticatedUsers: [{ user: 'mongo', db: 'admin' }],
          authenticatedUserRoles: [{ role: 'root', db: 'admin' }],
        },
        ok: 1,
      };
      const result = redactAdminResponse('connectionstatus', response);
      expect(result.authInfo.authenticatedUserRoles).toBeUndefined();
    });

    it('keeps authenticatedUsers', () => {
      const response = {
        authInfo: {
          authenticatedUsers: [{ user: 'mongo', db: 'admin' }],
          authenticatedUserRoles: [{ role: 'root', db: 'admin' }],
        },
        ok: 1,
      };
      const result = redactAdminResponse('connectionstatus', response);
      expect(result.authInfo.authenticatedUsers).toEqual([{ user: 'mongo', db: 'admin' }]);
    });

    it('keeps ok status', () => {
      const response = { authInfo: { authenticatedUsers: [] }, ok: 1 };
      const result = redactAdminResponse('connectionstatus', response);
      expect(result.ok).toBe(1);
    });
  });

  describe('getParameter', () => {
    it('strips authenticationMechanisms', () => {
      const response = {
        authenticationMechanisms: ['SCRAM-SHA-256'],
        maxBSONObjectSize: 16777216,
        ok: 1,
      };
      const result = redactAdminResponse('getparameter', response);
      expect(result.authenticationMechanisms).toBeUndefined();
      expect(result.maxBSONObjectSize).toBe(16777216);
    });

    it('strips scramIterationCount', () => {
      const response = { scramIterationCount: 10000, ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result.scramIterationCount).toBeUndefined();
    });

    it('strips scramSHA256IterationCount', () => {
      const response = { scramSHA256IterationCount: 15000, ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result.scramSHA256IterationCount).toBeUndefined();
    });

    it('strips saslHostName', () => {
      const response = { saslHostName: 'host123', ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result.saslHostName).toBeUndefined();
    });

    it('strips enableLocalhostAuthBypass', () => {
      const response = { enableLocalhostAuthBypass: true, ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result.enableLocalhostAuthBypass).toBeUndefined();
    });

    it('strips TLS/SSL related params', () => {
      const response = {
        tlsMode: 'disabled',
        sslMode: 'disabled',
        tlsCertificateKeyFile: '/path/to/key',
        tlsCAFile: '/path/to/ca',
        tlsClusterFile: '/path/to/cluster',
        ok: 1,
      };
      const result = redactAdminResponse('getparameter', response);
      expect(result.tlsMode).toBeUndefined();
      expect(result.sslMode).toBeUndefined();
      expect(result.tlsCertificateKeyFile).toBeUndefined();
      expect(result.tlsCAFile).toBeUndefined();
      expect(result.tlsClusterFile).toBeUndefined();
    });

    it('strips keyFile', () => {
      const response = { keyFile: '/path/to/keyfile', ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result.keyFile).toBeUndefined();
    });

    it('strips clusterAuthMode', () => {
      const response = { clusterAuthMode: 'keyFile', ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result.clusterAuthMode).toBeUndefined();
    });

    it('keeps safe params like maxBSONObjectSize', () => {
      const response = {
        maxBSONObjectSize: 16777216,
        internalQueryMaxBlockingSortMemoryUsageBytes: 104857600,
        ok: 1,
      };
      const result = redactAdminResponse('getparameter', response);
      expect(result.maxBSONObjectSize).toBe(16777216);
      expect(result.internalQueryMaxBlockingSortMemoryUsageBytes).toBe(104857600);
    });

    it('adds redaction notice', () => {
      const response = { authenticationMechanisms: ['SCRAM'], ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result._redacted).toBeDefined();
    });
  });

  describe('getLog', () => {
    it('strips log entries, keeps totalLinesWritten', () => {
      const response = {
        totalLinesWritten: 544,
        log: ['line1', 'line2', 'line3'],
        ok: 1,
      };
      const result = redactAdminResponse('getlog', response);
      expect(result.log).toBeUndefined();
      expect(result.totalLinesWritten).toBe(544);
    });

    it('adds redaction notice', () => {
      const response = { totalLinesWritten: 100, log: ['line1'], ok: 1 };
      const result = redactAdminResponse('getlog', response);
      expect(result._redacted).toBeDefined();
    });
  });

  describe('hostInfo', () => {
    it('strips extra section', () => {
      const response = {
        system: {
          currentTime: '2026-01-01',
          hostname: 'host1',
          cpuAddrSize: 64,
          memSizeMB: 13859,
          memLimitMB: 13859,
          numCores: 8,
          numPhysicalCores: 4,
          cpuArch: 'x86_64',
          cpuFrequencyMHz: '',
          numaEnabled: false,
          cpuFeatures: 'sse,sse2,avx,avx2',
        },
        os: { type: 'Linux', name: 'Ubuntu 22.04', version: 'Kernel 6.8.0' },
        extra: {
          versionString: 'Linux version 6.8.0',
          pageSize: 4096,
          numPages: 3547797,
          maxOpenFiles: 1048576,
        },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      expect(result.extra).toBeUndefined();
    });

    it('strips cpuFeatures from system', () => {
      const response = {
        system: { cpuFeatures: 'sse,sse2,avx', numCores: 8, cpuArch: 'x86_64' },
        os: { type: 'Linux' },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      expect(result.system.cpuFeatures).toBeUndefined();
    });

    it('keeps OS name, architecture, CPU count, memory', () => {
      const response = {
        system: { numCores: 8, cpuArch: 'x86_64', memSizeMB: 13859, cpuFeatures: 'flags' },
        os: { type: 'Linux', name: 'Ubuntu 22.04' },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      expect(result.system.numCores).toBe(8);
      expect(result.system.cpuArch).toBe('x86_64');
      expect(result.system.memSizeMB).toBe(13859);
      expect(result.os).toEqual({ type: 'Linux', name: 'Ubuntu 22.04' });
    });
  });

  describe('getCmdLineOpts', () => {
    it('strips argv', () => {
      const response = {
        argv: ['mongod', '--auth', '--bind_ip_all'],
        parsed: { net: { bindIp: '*' }, security: { authorization: 'enabled' } },
        ok: 1,
      };
      const result = redactAdminResponse('getcmdlineopts', response);
      expect(result.argv).toBeUndefined();
    });

    it('strips parsed', () => {
      const response = {
        argv: ['mongod'],
        parsed: { net: { bindIp: '*' } },
        ok: 1,
      };
      const result = redactAdminResponse('getcmdlineopts', response);
      expect(result.parsed).toBeUndefined();
    });

    it('keeps ok status', () => {
      const response = { argv: ['mongod'], parsed: {}, ok: 1 };
      const result = redactAdminResponse('getcmdlineopts', response);
      expect(result.ok).toBe(1);
    });

    it('adds redaction notice', () => {
      const response = { argv: ['mongod'], parsed: {}, ok: 1 };
      const result = redactAdminResponse('getcmdlineopts', response);
      expect(result._redacted).toBeDefined();
    });
  });

  describe('passthrough', () => {
    it('returns response unchanged for unrecognized commands', () => {
      const response = { data: 'test', ok: 1 };
      const result = redactAdminResponse('ping', response);
      expect(result).toEqual(response);
    });

    it('returns response unchanged for serverStatus', () => {
      const response = { version: '7.0', uptime: 12345, ok: 1 };
      const result = redactAdminResponse('serverstatus', response);
      expect(result).toEqual(response);
    });
  });
});
