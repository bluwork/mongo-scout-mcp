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
    it('strips unknown/unrecognized parameters by default (allowlist approach)', () => {
      const response = {
        ldapServers: 'ldap://internal.corp:389',
        auditLogDestination: 'file',
        someFutureMongoParam: 'sensitive-value',
        ok: 1,
      };
      const result = redactAdminResponse('getparameter', response);
      expect(result.ldapServers).toBeUndefined();
      expect(result.auditLogDestination).toBeUndefined();
      expect(result.someFutureMongoParam).toBeUndefined();
    });

    it('strips known sensitive params (auth, TLS, keys)', () => {
      const response = {
        authenticationMechanisms: ['SCRAM-SHA-256'],
        tlsMode: 'disabled',
        keyFile: '/path/to/keyfile',
        clusterAuthMode: 'keyFile',
        scramIterationCount: 10000,
        ok: 1,
      };
      const result = redactAdminResponse('getparameter', response);
      expect(result.authenticationMechanisms).toBeUndefined();
      expect(result.tlsMode).toBeUndefined();
      expect(result.keyFile).toBeUndefined();
      expect(result.clusterAuthMode).toBeUndefined();
      expect(result.scramIterationCount).toBeUndefined();
    });

    it('keeps allowlisted safe operational params', () => {
      const response = {
        maxBSONObjectSize: 16777216,
        internalQueryMaxBlockingSortMemoryUsageBytes: 104857600,
        ok: 1,
      };
      const result = redactAdminResponse('getparameter', response);
      expect(result.maxBSONObjectSize).toBe(16777216);
      expect(result.internalQueryMaxBlockingSortMemoryUsageBytes).toBe(104857600);
      expect(result.ok).toBe(1);
    });

    it('adds redaction notice when params are stripped', () => {
      const response = { authenticationMechanisms: ['SCRAM'], ok: 1 };
      const result = redactAdminResponse('getparameter', response);
      expect(result._redacted).toBeDefined();
    });

    it('only returns allowlisted keys from a realistic getParameter * response', () => {
      const response = {
        // Safe operational params
        maxBSONObjectSize: 16777216,
        maxMessageSizeBytes: 48000000,
        maxWriteBatchSize: 100000,
        ok: 1,
        // Sensitive params that must NOT leak
        authenticationMechanisms: ['SCRAM-SHA-256'],
        tlsCertificateKeyFile: '/etc/mongo/key.pem',
        keyFile: '/etc/mongo/keyfile',
        ldapServers: 'ldap://corp.internal',
        auditLogPath: '/var/log/mongo/audit.json',
        wiredTigerEngineRuntimeConfig: 'cache_size=4G',
      };
      const result = redactAdminResponse('getparameter', response);
      const keys = Object.keys(result).filter(k => k !== '_redacted');
      // Every key in the result must be either 'ok' or a known-safe param
      for (const key of keys) {
        expect(['maxBSONObjectSize', 'maxMessageSizeBytes', 'maxWriteBatchSize', 'ok']).toContain(key);
      }
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
    it('strips os.version (leaks exact kernel version)', () => {
      const response = {
        system: { numCores: 8, cpuArch: 'x86_64', memSizeMB: 13859 },
        os: { type: 'Linux', name: 'Ubuntu 22.04', version: '6.8.0-101-generic' },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      expect(result.os.version).toBeUndefined();
    });

    it('strips system.hostname (leaks internal naming)', () => {
      const response = {
        system: { hostname: 'prod-db-01.internal', numCores: 8, cpuArch: 'x86_64', memSizeMB: 13859 },
        os: { type: 'Linux', name: 'Ubuntu 22.04' },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      expect(result.system.hostname).toBeUndefined();
    });

    it('strips system.currentTime, cpuFeatures, and extra', () => {
      const response = {
        system: {
          currentTime: '2026-01-01T00:00:00Z',
          hostname: 'host1',
          cpuFeatures: 'sse,sse2,avx,avx2',
          numCores: 8,
          cpuArch: 'x86_64',
          memSizeMB: 13859,
          numPhysicalCores: 4,
        },
        os: { type: 'Linux', name: 'Ubuntu 22.04', version: '6.8.0' },
        extra: { versionString: 'Linux version 6.8.0', pageSize: 4096 },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      expect(result.extra).toBeUndefined();
      expect(result.system.cpuFeatures).toBeUndefined();
      expect(result.system.currentTime).toBeUndefined();
      expect(result.system.hostname).toBeUndefined();
      expect(result.os.version).toBeUndefined();
    });

    it('keeps only allowlisted system and os fields', () => {
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
          cpuFrequencyMHz: '3200',
          numaEnabled: false,
          cpuFeatures: 'sse,sse2,avx',
        },
        os: { type: 'Linux', name: 'Ubuntu 22.04', version: '6.8.0-101-generic' },
        extra: { pageSize: 4096 },
        ok: 1,
      };
      const result = redactAdminResponse('hostinfo', response);
      // system: only numCores, numPhysicalCores, cpuArch, memSizeMB
      expect(Object.keys(result.system).sort()).toEqual(
        ['cpuArch', 'memSizeMB', 'numCores', 'numPhysicalCores'].sort()
      );
      // os: only type and name
      expect(Object.keys(result.os).sort()).toEqual(['name', 'type'].sort());
      expect(result.ok).toBe(1);
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
