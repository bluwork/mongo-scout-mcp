export const DANGEROUS_OPERATORS = ['$where', '$function', '$accumulator', '$eval'];

export interface OperatorScanResult {
  found: boolean;
  operator?: string;
  path?: string;
}

export function scanForDangerousOperators(obj: unknown, currentPath = ''): OperatorScanResult {
  if (!obj || typeof obj !== 'object') {
    return { found: false };
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = scanForDangerousOperators(obj[i], `${currentPath}[${i}]`);
      if (result.found) return result;
    }
    return { found: false };
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (DANGEROUS_OPERATORS.some(op => op.toLowerCase() === key.toLowerCase())) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      return { found: true, operator: key, path };
    }

    const nestedPath = currentPath ? `${currentPath}.${key}` : key;
    const result = scanForDangerousOperators(value, nestedPath);
    if (result.found) return result;
  }

  return { found: false };
}

export function assertNoDangerousOperators(obj: unknown, context: string): void {
  const result = scanForDangerousOperators(obj);
  if (result.found) {
    throw new Error(
      `Operator ${result.operator} is blocked in ${context}: server-side JavaScript execution is not allowed. Found at: ${result.path}`
    );
  }
}
