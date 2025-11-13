const adminOpLimiter = new Map<string, { count: number; resetTime: number }>();
const ADMIN_RATE_LIMIT = 100; // requests per minute
const ADMIN_WINDOW_MS = 60000; // 1 minute
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, value] of adminOpLimiter.entries()) {
    if (now > value.resetTime + ADMIN_WINDOW_MS) {
      adminOpLimiter.delete(key);
    }
  }
}

setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);

export function checkAdminRateLimit(operation: string): boolean {
  const now = Date.now();
  const key = operation;
  const current = adminOpLimiter.get(key) || { count: 0, resetTime: now + ADMIN_WINDOW_MS };

  if (now > current.resetTime) {
    current.count = 0;
    current.resetTime = now + ADMIN_WINDOW_MS;
  }

  if (current.count >= ADMIN_RATE_LIMIT) {
    return false;
  }

  current.count++;
  adminOpLimiter.set(key, current);
  return true;
}

export { ADMIN_RATE_LIMIT };
