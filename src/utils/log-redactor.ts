const SENSITIVE_PATTERNS = ['password', 'token', 'secret', 'key', 'connectionstring'];

export function redactSensitiveKeys<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveKeys(item)) as T;
  }

  // Only process plain objects — preserve Date, ObjectId, Map, class instances, etc.
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_PATTERNS.some(pattern => key.toLowerCase().includes(pattern))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveKeys(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
