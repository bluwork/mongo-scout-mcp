import { describe, it, expect, vi } from 'vitest';
import { wrapServerWithNameValidation, COLLECTION_PARAMS, DATABASE_PARAMS } from './index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function createMockServer() {
  const registeredTools: Record<string, { handler: Function }> = {};
  const server = {
    tool: vi.fn((...args: unknown[]) => {
      const toolName = args[0] as string;
      const handler = args[args.length - 1] as Function;
      registeredTools[toolName] = { handler };
    }),
  } as unknown as McpServer;
  return { server, registeredTools };
}

describe('wrapServerWithNameValidation', () => {
  it('exports COLLECTION_PARAMS and DATABASE_PARAMS constants', () => {
    expect(COLLECTION_PARAMS).toContain('collection');
    expect(COLLECTION_PARAMS).toContain('name');
    expect(COLLECTION_PARAMS).toContain('source');
    expect(COLLECTION_PARAMS).toContain('destination');
    expect(DATABASE_PARAMS).toContain('database');
  });

  describe('collection name validation', () => {
    it('blocks system.profile in collection param', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      wrapped.tool('find', 'find docs', {}, handler);

      const result = await registeredTools['find'].handler({ collection: 'system.profile' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/system\./i);
      expect(handler).not.toHaveBeenCalled();
    });

    it('blocks system.users in name param (createCollection)', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      wrapped.tool('createCollection', 'create', {}, handler);

      const result = await registeredTools['createCollection'].handler({ name: 'system.users' });
      expect(result.isError).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows normal collection names through', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const expectedResult = { content: [{ type: 'text', text: 'ok' }] };
      const handler = vi.fn().mockResolvedValue(expectedResult);
      wrapped.tool('find', 'find docs', {}, handler);

      const result = await registeredTools['find'].handler({ collection: 'users' });
      expect(result).toEqual(expectedResult);
      expect(handler).toHaveBeenCalledWith({ collection: 'users' });
    });

    it('blocks null bytes in collection names', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      wrapped.tool('find', 'find docs', {}, handler);

      const result = await registeredTools['find'].handler({ collection: 'users\0admin' });
      expect(result.isError).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('database name validation', () => {
    it('blocks access to admin database', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      wrapped.tool('getDatabaseStats', 'stats', {}, handler);

      const result = await registeredTools['getDatabaseStats'].handler({ database: 'admin' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/allowed/i);
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows configured database name', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const expectedResult = { content: [{ type: 'text', text: 'ok' }] };
      const handler = vi.fn().mockResolvedValue(expectedResult);
      wrapped.tool('getDatabaseStats', 'stats', {}, handler);

      const result = await registeredTools['getDatabaseStats'].handler({ database: 'testdb' });
      expect(result).toEqual(expectedResult);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('tools without collection/database params', () => {
    it('passes through tools with no matching params', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const expectedResult = { content: [{ type: 'text', text: 'ok' }] };
      const handler = vi.fn().mockResolvedValue(expectedResult);
      wrapped.tool('getServerStatus', 'status', {}, handler);

      const result = await registeredTools['getServerStatus'].handler({ includeHost: true });
      expect(result).toEqual(expectedResult);
      expect(handler).toHaveBeenCalled();
    });

    it('passes through tools with no args', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const expectedResult = { content: [{ type: 'text', text: 'ok' }] };
      const handler = vi.fn().mockResolvedValue(expectedResult);
      wrapped.tool('listCollections', 'list', {}, handler);

      const result = await registeredTools['listCollections'].handler({});
      expect(result).toEqual(expectedResult);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('optional database param (undefined)', () => {
    it('passes through when database param is undefined', async () => {
      const { server, registeredTools } = createMockServer();
      const wrapped = wrapServerWithNameValidation(server, 'testdb');

      const expectedResult = { content: [{ type: 'text', text: 'ok' }] };
      const handler = vi.fn().mockResolvedValue(expectedResult);
      wrapped.tool('getDatabaseStats', 'stats', {}, handler);

      const result = await registeredTools['getDatabaseStats'].handler({});
      expect(result).toEqual(expectedResult);
      expect(handler).toHaveBeenCalled();
    });
  });
});
