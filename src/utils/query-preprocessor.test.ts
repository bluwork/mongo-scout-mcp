import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { preprocessQuery } from './query-preprocessor.js';

describe('preprocessQuery', () => {
  it('returns empty object for empty query', () => {
    expect(preprocessQuery({})).toEqual({});
  });

  it('passes through non-ObjectId fields unchanged', () => {
    const query = { name: 'test', age: 25 };
    expect(preprocessQuery(query)).toEqual({ name: 'test', age: 25 });
  });

  it('converts string _id to ObjectId', () => {
    const id = new ObjectId();
    const result = preprocessQuery({ _id: id.toHexString() });
    expect(result._id).toBeInstanceOf(ObjectId);
    expect((result._id as ObjectId).toHexString()).toBe(id.toHexString());
  });

  it('converts extended JSON { $oid } to ObjectId for _id', () => {
    const id = new ObjectId();
    const result = preprocessQuery({ _id: { $oid: id.toHexString() } });
    expect(result._id).toBeInstanceOf(ObjectId);
    expect((result._id as ObjectId).toHexString()).toBe(id.toHexString());
  });

  it('converts fields ending in Id (e.g. userId)', () => {
    const id = new ObjectId();
    const result = preprocessQuery({ userId: id.toHexString() });
    expect(result.userId).toBeInstanceOf(ObjectId);
  });

  it('converts extended JSON in fields ending in Id', () => {
    const id = new ObjectId();
    const result = preprocessQuery({ authorId: { $oid: id.toHexString() } });
    expect(result.authorId).toBeInstanceOf(ObjectId);
  });

  it('handles $in operator with ObjectId strings', () => {
    const id1 = new ObjectId();
    const id2 = new ObjectId();
    const result = preprocessQuery({
      _id: { $in: [id1.toHexString(), id2.toHexString()] },
    });
    const inArray = (result._id as Record<string, unknown>).$in as ObjectId[];
    expect(inArray[0]).toBeInstanceOf(ObjectId);
    expect(inArray[1]).toBeInstanceOf(ObjectId);
  });

  it('handles $in operator with extended JSON ObjectIds', () => {
    const id1 = new ObjectId();
    const result = preprocessQuery({
      _id: { $in: [{ $oid: id1.toHexString() }] },
    });
    const inArray = (result._id as Record<string, unknown>).$in as ObjectId[];
    expect(inArray[0]).toBeInstanceOf(ObjectId);
  });

  it('does not convert non-ObjectId-like fields', () => {
    const result = preprocessQuery({ name: '507f1f77bcf86cd799439011' });
    expect(result.name).toBe('507f1f77bcf86cd799439011');
  });

  it('recursively processes nested objects', () => {
    const id = new ObjectId();
    const result = preprocessQuery({
      $and: [{ _id: id.toHexString() }],
    });
    const andArray = result.$and as Record<string, unknown>[];
    expect(andArray[0]._id).toBeInstanceOf(ObjectId);
  });

  it('handles null/undefined gracefully', () => {
    expect(preprocessQuery(null as any)).toBeNull();
    expect(preprocessQuery(undefined as any)).toBeUndefined();
  });

  it('throws on $where operator', () => {
    expect(() => preprocessQuery({ $where: 'sleep(1000)' })).toThrow(/\$where.*blocked.*query filter/i);
  });

  it('throws on nested $function operator', () => {
    expect(() =>
      preprocessQuery({ $expr: { $function: { body: 'bad', args: [], lang: 'js' } } })
    ).toThrow(/\$function.*blocked/i);
  });
});
