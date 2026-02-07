import { MongoNetworkError, MongoServerClosedError, MongoNotConnectedError } from 'mongodb';
import { logError } from './logger.js';

const CONNECTION_ERROR_NAMES = [
  'MongoNetworkError',
  'MongoServerClosedError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
  'MongoNetworkTimeoutError',
];

const CONNECTION_ERROR_PATTERNS = [
  'topology was destroyed',
  'topology is closed',
  'connection closed',
  'connection pool cleared',
  'server selection timed out',
  'not connected',
  'client must be connected',
];

export function isConnectionError(error: unknown): boolean {
  if (
    error instanceof MongoNetworkError ||
    error instanceof MongoServerClosedError ||
    error instanceof MongoNotConnectedError
  ) {
    return true;
  }

  if (error instanceof Error) {
    if (CONNECTION_ERROR_NAMES.includes(error.constructor.name)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return CONNECTION_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
  }

  return false;
}

const CONNECTION_LOST_MESSAGE =
  'MongoDB connection lost. The server can no longer communicate with the database. ' +
  'Please restart the MCP server to re-establish the connection.';

export function withConnectionGuard<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    try {
      return await handler(args);
    } catch (error) {
      if (isConnectionError(error)) {
        logError(toolName, error, args);

        return {
          content: [
            {
              type: 'text' as const,
              text: `[${toolName}] ${CONNECTION_LOST_MESSAGE}`,
            },
          ],
        } as TResult;
      }

      throw error;
    }
  };
}
