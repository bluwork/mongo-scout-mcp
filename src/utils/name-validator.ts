export interface NameValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCollectionName(name: string): NameValidationResult {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Collection name must not be empty' };
  }

  if (name.includes('\0')) {
    return { valid: false, error: 'Collection name must not contain null bytes' };
  }

  if (name.startsWith('system.')) {
    return { valid: false, error: `Access to system collection '${name}' is not allowed` };
  }

  return { valid: true };
}
