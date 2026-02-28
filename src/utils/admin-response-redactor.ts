/** Allowlist: only these getParameter keys pass through. Everything else is redacted. */
const SAFE_GETPARAMETER_KEYS = new Set([
  'ok',
  'maxBSONObjectSize',
  'maxMessageSizeBytes',
  'maxWriteBatchSize',
  'maxWireVersion',
  'minWireVersion',
  'internalQueryMaxBlockingSortMemoryUsageBytes',
  'internalQueryExecMaxBlockingSortBytes',
  'internalQueryFacetBufferSizeBytes',
  'internalDocumentSourceGroupMaxMemoryBytes',
  'internalQueryMaxAddToSetBytes',
  'cursor',
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
    if (SAFE_GETPARAMETER_KEYS.has(key)) {
      result[key] = value;
    } else {
      redactedCount++;
    }
  }
  if (redactedCount > 0) {
    result._redacted = `${redactedCount} parameter(s) redacted. Only safe operational params are shown.`;
  }
  return result;
}

function redactGetLog(response: Record<string, any>): Record<string, any> {
  const result = { ...response };
  delete result.log;
  result._redacted = 'Log entries redacted. Use MongoDB shell for direct log access.';
  return result;
}

const SAFE_HOSTINFO_SYSTEM_KEYS = new Set(['numCores', 'numPhysicalCores', 'cpuArch', 'memSizeMB']);
const SAFE_HOSTINFO_OS_KEYS = new Set(['type', 'name']);

function redactHostInfo(response: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ok: response.ok };

  if (response.system && typeof response.system === 'object') {
    const system: Record<string, any> = {};
    for (const [key, value] of Object.entries(response.system)) {
      if (SAFE_HOSTINFO_SYSTEM_KEYS.has(key)) {
        system[key] = value;
      }
    }
    result.system = system;
  }

  if (response.os && typeof response.os === 'object') {
    const os: Record<string, any> = {};
    for (const [key, value] of Object.entries(response.os)) {
      if (SAFE_HOSTINFO_OS_KEYS.has(key)) {
        os[key] = value;
      }
    }
    result.os = os;
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
