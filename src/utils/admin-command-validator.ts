export interface AdminCommandValidationResult {
  valid: boolean;
  sanitizedCommand: Record<string, unknown>;
  warnings: string[];
}

const ALLOWED_PARAMS: Record<string, string[]> = {
  serverstatus: ['serverStatus'],
  dbstats: ['dbStats', 'scale'],
  collstats: ['collStats', 'scale'],
  replsetstatus: ['replSetGetStatus', 'replsetstatus'],
  replsetgetconfig: ['replSetGetConfig'],
  ismaster: ['isMaster', 'ismaster'],
  hello: ['hello'],
  ping: ['ping'],
  buildinfo: ['buildInfo', 'buildinfo'],
  connectionstatus: ['connectionStatus', 'showPrivileges', 'showAuthenticatedUsers'],
  getcmdlineopts: ['getCmdLineOpts', 'getcmdlineopts'],
  hostinfo: ['hostInfo', 'hostinfo'],
  listdatabases: ['listDatabases', 'filter', 'nameOnly', 'authorizedDatabases'],
  listcommands: ['listCommands', 'listcommands'],
  profile: ['profile', 'slowms', 'sampleRate'],
  currentop: ['currentOp', '$all', '$ownOps', '$local', '$truncateOps'],
  top: ['top'],
  validate: ['validate', 'full', 'repair'],
  explain: ['explain', 'verbosity'],
  getlog: ['getLog'],
  getparameter: ['getParameter', 'allParameters'],
  connpoolstats: ['connPoolStats'],
  shardingstatus: ['shardingState', 'shardingstatus'],
};

const MAX_OBJECT_DEPTH = 2;

function checkDepth(value: unknown, currentDepth: number): boolean {
  if (currentDepth > MAX_OBJECT_DEPTH) return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).every((v) =>
      checkDepth(v, currentDepth + 1)
    );
  }
  if (Array.isArray(value)) {
    return value.every((v) => checkDepth(v, currentDepth));
  }
  return true;
}

export function validateAdminCommandParams(
  command: Record<string, unknown>,
  commandName: string
): AdminCommandValidationResult {
  const warnings: string[] = [];
  const lowerName = commandName.toLowerCase();
  const allowedKeys = ALLOWED_PARAMS[lowerName];

  // If we don't have a specific allow list for this command, pass through
  // but still check depth
  if (!allowedKeys) {
    if (!checkDepth(command, 0)) {
      return {
        valid: false,
        sanitizedCommand: command,
        warnings: ['Command parameters contain deeply nested objects (depth > 2), which is not allowed.'],
      };
    }
    return { valid: true, sanitizedCommand: command, warnings };
  }

  // Also always allow maxTimeMS (added by the caller)
  // Include lowercase variants of allowed keys so that e.g. { dbstats: 1 }
  // is accepted alongside { dbStats: 1 }
  const fullAllowedKeys = [...allowedKeys, 'maxTimeMS'];
  const allowedSet = new Set(fullAllowedKeys);
  for (const k of fullAllowedKeys) {
    allowedSet.add(k.toLowerCase());
  }

  const sanitizedCommand: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(command)) {
    if (allowedSet.has(key) || allowedSet.has(key.toLowerCase())) {
      sanitizedCommand[key] = value;
    } else {
      warnings.push(`Stripped unknown parameter '${key}' from ${commandName} command.`);
    }
  }

  // Check depth of remaining values
  for (const [key, value] of Object.entries(sanitizedCommand)) {
    if (!checkDepth(value, 0)) {
      return {
        valid: false,
        sanitizedCommand,
        warnings: [
          ...warnings,
          `Parameter '${key}' contains deeply nested objects (depth > ${MAX_OBJECT_DEPTH}), which is not allowed.`,
        ],
      };
    }
  }

  return { valid: true, sanitizedCommand, warnings };
}
