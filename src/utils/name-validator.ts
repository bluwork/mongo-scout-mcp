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

export function validateFieldName(name: string): NameValidationResult {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Field name must not be empty' };
  }

  if (name.includes('\0')) {
    return { valid: false, error: 'Field name must not contain null bytes' };
  }

  if (name.startsWith('$')) {
    return { valid: false, error: `Field name must not start with $: '${name}'` };
  }

  return { valid: true };
}

export function validateDatabaseName(name: string, allowedDbName: string): NameValidationResult {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Database name must not be empty' };
  }

  if (name.includes('\0')) {
    return { valid: false, error: 'Database name must not contain null bytes' };
  }

  if (name !== allowedDbName) {
    return { valid: false, error: `Database '${name}' is not the allowed database. Only '${allowedDbName}' can be accessed` };
  }

  return { valid: true };
}
