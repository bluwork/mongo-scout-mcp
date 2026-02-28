import { ObjectId } from 'mongodb';
import type { MongoQuery, MongoFilter } from '../types.js';
import { assertNoDangerousOperators } from './operator-validator.js';
import { validateFilterDepth } from './filter-validator.js';

function isObjectIdField(fieldName: string): boolean {
  const objectIdPatterns = [
    /^_id$/,
    /Id$/,
    /^id$/i,
    /_id$/,
    /^ref/i,
  ];

  return objectIdPatterns.some(pattern => pattern.test(fieldName));
}

function isExtendedJsonObjectId(value: unknown): value is { $oid: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$oid' in value &&
    typeof (value as { $oid: unknown }).$oid === 'string'
  );
}

function preprocessQueryValue(value: unknown, fieldName?: string): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (isExtendedJsonObjectId(value)) {
    return new ObjectId(value.$oid);
  }

  const processed: Record<string, unknown> = {};
  const isObjectIdFieldName = fieldName ? isObjectIdField(fieldName) : false;

  for (const [operator, operatorValue] of Object.entries(value as Record<string, unknown>)) {
    if (operator.startsWith('$')) {
      if (Array.isArray(operatorValue)) {
        processed[operator] = operatorValue.map(item => {
          if (isExtendedJsonObjectId(item)) {
            return new ObjectId(item.$oid);
          }
          if (isObjectIdFieldName && typeof item === 'string' && ObjectId.isValid(item)) {
            return new ObjectId(item);
          }
          return item;
        });
      } else if (isExtendedJsonObjectId(operatorValue)) {
        processed[operator] = new ObjectId(operatorValue.$oid);
      } else if (isObjectIdFieldName && typeof operatorValue === 'string' && ObjectId.isValid(operatorValue)) {
        processed[operator] = new ObjectId(operatorValue);
      } else {
        processed[operator] = operatorValue;
      }
    } else {
      processed[operator] = operatorValue;
    }
  }

  return processed;
}

function preprocessQueryInner(query: MongoQuery): MongoFilter {
  if (!query || typeof query !== 'object') {
    return query;
  }

  const processed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    if (isObjectIdField(key)) {
      if (isExtendedJsonObjectId(value)) {
        processed[key] = new ObjectId(value.$oid);
      } else if (typeof value === 'string' && ObjectId.isValid(value)) {
        processed[key] = new ObjectId(value);
      } else if (typeof value === 'object' && value !== null) {
        processed[key] = preprocessQueryValue(value, key);
      } else {
        processed[key] = value;
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      processed[key] = preprocessQueryInner(value as MongoQuery);
    } else if (Array.isArray(value)) {
      processed[key] = value.map(item => {
        if (isExtendedJsonObjectId(item)) {
          return new ObjectId(item.$oid);
        }
        if (isObjectIdField(key) && typeof item === 'string' && ObjectId.isValid(item)) {
          return new ObjectId(item);
        }
        return typeof item === 'object' ? preprocessQueryInner(item as MongoQuery) : item;
      });
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

export function preprocessQuery(query: MongoQuery): MongoFilter {
  if (!query || typeof query !== 'object') {
    return query;
  }

  assertNoDangerousOperators(query, 'query filter');
  const depthCheck = validateFilterDepth(query as Record<string, any>);
  if (!depthCheck.valid) {
    throw new Error(depthCheck.error);
  }
  return preprocessQueryInner(query);
}
