const SENSITIVE_GETPARAMETER_KEYS = new Set([
  'authenticationMechanisms',
  'scramIterationCount',
  'scramSHA256IterationCount',
  'saslHostName',
  'saslauthdPath',
  'enableLocalhostAuthBypass',
  'tlsMode',
  'sslMode',
  'tlsCertificateKeyFile',
  'tlsCAFile',
  'tlsClusterFile',
  'tlsCertificateKeyFilePassword',
  'tlsClusterCAFile',
  'tlsWithholdClientCertificate',
  'keyFile',
  'clusterAuthMode',
  'saslServiceName',
  'opensslCipherConfig',
  'opensslCipherSuiteConfig',
  'disableJavaScriptJIT',
]);

function redactConnectionStatus(response: Record<string, any>): Record<string, any> {
  const result = { ...response };
  if (result.authInfo && typeof result.authInfo === 'object') {
    const authInfo = { ...result.authInfo };
    delete authInfo.authenticatedUserPrivileges;
    delete authInfo.authenticatedUserRoles;
    result.authInfo = authInfo;
  }
  return result;
}

function redactGetParameter(response: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  let redactedCount = 0;
  for (const [key, value] of Object.entries(response)) {
    if (SENSITIVE_GETPARAMETER_KEYS.has(key)) {
      redactedCount++;
    } else {
      result[key] = value;
    }
  }
  if (redactedCount > 0) {
    result._redacted = `${redactedCount} sensitive parameter(s) removed (auth, TLS, key config)`;
  }
  return result;
}

function redactGetLog(response: Record<string, any>): Record<string, any> {
  const result = { ...response };
  delete result.log;
  result._redacted = 'Log entries redacted. Use MongoDB shell for direct log access.';
  return result;
}

function redactHostInfo(response: Record<string, any>): Record<string, any> {
  const result = { ...response };
  delete result.extra;
  if (result.system && typeof result.system === 'object') {
    const system = { ...result.system };
    delete system.cpuFeatures;
    result.system = system;
  }
  return result;
}

function redactGetCmdLineOpts(response: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ok: response.ok };
  result._redacted = 'Startup configuration redacted. Use MongoDB shell for direct access.';
  return result;
}

const REDACTORS: Record<string, (r: Record<string, any>) => Record<string, any>> = {
  connectionstatus: redactConnectionStatus,
  getparameter: redactGetParameter,
  getlog: redactGetLog,
  hostinfo: redactHostInfo,
  getcmdlineopts: redactGetCmdLineOpts,
};

export function redactAdminResponse(
  commandName: string,
  response: Record<string, any>,
): Record<string, any> {
  const redactor = REDACTORS[commandName.toLowerCase()];
  if (!redactor) return response;
  return redactor(response);
}
