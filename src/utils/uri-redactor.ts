/**
 * Redacts credentials from a MongoDB connection URI.
 * mongodb://user:pass@host → mongodb://***:***@host
 */
export function redactUri(uri: string): string {
  if (!uri) return uri;
  return uri.replace(
    /^(mongodb(?:\+srv)?:\/\/)([^:@]+)(?::([^@]+))?@/,
    (_, protocol, _user, password) =>
      password !== undefined
        ? `${protocol}***:***@`
        : `${protocol}***@`
  );
}

/**
 * Finds and redacts all MongoDB URIs embedded in an arbitrary string.
 */
export function redactString(str: string): string {
  if (!str) return str;
  return str.replace(
    /mongodb(?:\+srv)?:\/\/[^:@\s]+(?::[^@\s]+)?@/g,
    (match) => {
      const protocol = match.startsWith('mongodb+srv') ? 'mongodb+srv://' : 'mongodb://';
      return `${protocol}***:***@`;
    }
  );
}
