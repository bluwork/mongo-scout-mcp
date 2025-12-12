import { ObjectId } from 'mongodb';

export function convertObjectIdsToExtendedJson(obj: unknown): unknown {
  if (obj instanceof ObjectId) {
    return { $oid: obj.toHexString() };
  }

  if (Array.isArray(obj)) {
    return obj.map(convertObjectIdsToExtendedJson);
  }

  if (obj && typeof obj === 'object') {
    // Only process plain objects - skip objects with custom toJSON methods
    // (Date, Decimal128, Long, etc.) so they serialize correctly
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return obj;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertObjectIdsToExtendedJson(value);
    }
    return result;
  }

  return obj;
}

export function sanitizeResponse<T>(data: T): T {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = ['connectionString', 'password', 'key', 'secret', 'token'];

  const converted = convertObjectIdsToExtendedJson(data);
  const sanitized = JSON.parse(JSON.stringify(converted)) as T;

  function sanitizeObject(obj: Record<string, unknown>): void {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        obj[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitizeObject(value as Record<string, unknown>);
      }
    }
  }

  sanitizeObject(sanitized as Record<string, unknown>);
  return sanitized;
}
