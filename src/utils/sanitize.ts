export function sanitizeResponse<T>(data: T): T {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = ['connectionString', 'password', 'key', 'secret', 'token'];
  const sanitized = JSON.parse(JSON.stringify(data)) as T;

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
