import { describe, it, expect } from 'vitest';
import { redactUri, redactString } from './uri-redactor.js';

describe('redactUri', () => {
  it('redacts username and password from mongodb:// URI', () => {
    const uri = 'mongodb://testuser:testpass@localhost:27017/mydb';
    expect(redactUri(uri)).toBe('mongodb://***:***@localhost:27017/mydb');
  });

  it('redacts username and password from mongodb+srv:// URI', () => {
    const uri = 'mongodb+srv://testuser:p%40ss@cluster0.example.net/db';
    expect(redactUri(uri)).toBe('mongodb+srv://***:***@cluster0.example.net/db');
  });

  it('leaves URI without credentials unchanged', () => {
    const uri = 'mongodb://localhost:27017/mydb';
    expect(redactUri(uri)).toBe('mongodb://localhost:27017/mydb');
  });

  it('handles URI with only username (no password)', () => {
    const uri = 'mongodb://testuser@localhost:27017/mydb';
    expect(redactUri(uri)).toBe('mongodb://***@localhost:27017/mydb');
  });

  it('returns non-mongodb strings unchanged', () => {
    expect(redactUri('not a uri')).toBe('not a uri');
  });

  it('handles empty string', () => {
    expect(redactUri('')).toBe('');
  });
});

describe('redactString', () => {
  it('redacts mongodb URIs embedded in error messages', () => {
    const msg = 'Failed to connect to mongodb://testuser:testpass@host:27017/db';
    const result = redactString(msg);
    expect(result).toContain('***:***@');
    expect(result).not.toContain('testpass');
  });

  it('leaves strings without URIs unchanged', () => {
    const msg = 'Some random error occurred';
    expect(redactString(msg)).toBe(msg);
  });

  it('redacts multiple URIs in one string', () => {
    const msg = 'primary: mongodb://u1:p1@h1/db, secondary: mongodb://u2:p2@h2/db';
    const result = redactString(msg);
    expect(result).not.toContain('p1');
    expect(result).not.toContain('p2');
  });
});
