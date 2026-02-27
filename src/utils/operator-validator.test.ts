import { describe, it, expect } from 'vitest';
import { scanForDangerousOperators, assertNoDangerousOperators, DANGEROUS_OPERATORS } from './operator-validator.js';

describe('DANGEROUS_OPERATORS', () => {
  it('includes all known JS execution operators', () => {
    expect(DANGEROUS_OPERATORS).toContain('$where');
    expect(DANGEROUS_OPERATORS).toContain('$function');
    expect(DANGEROUS_OPERATORS).toContain('$accumulator');
    expect(DANGEROUS_OPERATORS).toContain('$eval');
  });
});

describe('scanForDangerousOperators', () => {
  describe('safe inputs', () => {
    it('returns not found for empty object', () => {
      const result = scanForDangerousOperators({});
      expect(result.found).toBe(false);
    });

    it('returns not found for null', () => {
      const result = scanForDangerousOperators(null);
      expect(result.found).toBe(false);
    });

    it('returns not found for undefined', () => {
      const result = scanForDangerousOperators(undefined);
      expect(result.found).toBe(false);
    });

    it('returns not found for primitives', () => {
      expect(scanForDangerousOperators('string').found).toBe(false);
      expect(scanForDangerousOperators(42).found).toBe(false);
      expect(scanForDangerousOperators(true).found).toBe(false);
    });

    it('allows safe query operators', () => {
      const query = {
        $gt: 10,
        $in: [1, 2, 3],
        $regex: '^test',
        $exists: true,
        $type: 'string',
        $elemMatch: { x: 1 },
      };
      expect(scanForDangerousOperators(query).found).toBe(false);
    });

    it('allows $expr with safe sub-expressions', () => {
      const query = {
        $expr: { $gt: ['$field1', '$field2'] },
      };
      expect(scanForDangerousOperators(query).found).toBe(false);
    });

    it('allows $text search operator', () => {
      const query = { $text: { $search: 'hello' } };
      expect(scanForDangerousOperators(query).found).toBe(false);
    });

    it('allows arrays of safe objects', () => {
      const pipeline = [
        { $match: { status: 'active' } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ];
      expect(scanForDangerousOperators(pipeline).found).toBe(false);
    });
  });

  describe('top-level dangerous operators', () => {
    it('detects $where', () => {
      const result = scanForDangerousOperators({ $where: 'sleep(10000)' });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$where');
    });

    it('detects $function', () => {
      const result = scanForDangerousOperators({
        $function: { body: 'function() {}', args: [], lang: 'js' },
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$function');
    });

    it('detects $accumulator', () => {
      const result = scanForDangerousOperators({
        $accumulator: { init: 'function() {}', accumulate: 'function() {}' },
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$accumulator');
    });

    it('detects $eval', () => {
      const result = scanForDangerousOperators({ $eval: 'db.test.find()' });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$eval');
    });
  });

  describe('nested dangerous operators', () => {
    it('detects $where inside $and', () => {
      const result = scanForDangerousOperators({
        $and: [{ status: 'active' }, { $where: 'this.x > 1' }],
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$where');
      expect(result.path).toContain('$where');
    });

    it('detects $function inside $or inside $and (3 levels deep)', () => {
      const result = scanForDangerousOperators({
        $and: [
          {
            $or: [
              {
                field: {
                  $function: { body: 'bad()', args: [], lang: 'js' },
                },
              },
            ],
          },
        ],
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$function');
    });

    it('detects $where inside $not', () => {
      const result = scanForDangerousOperators({
        $not: { $where: 'true' },
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$where');
    });

    it('detects $where inside $nor', () => {
      const result = scanForDangerousOperators({
        $nor: [{ $where: 'false' }],
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$where');
    });

    it('detects $function inside $expr', () => {
      const result = scanForDangerousOperators({
        $expr: {
          $function: { body: 'return true', args: [], lang: 'js' },
        },
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$function');
    });

    it('detects $accumulator inside $group in pipeline stage', () => {
      const pipeline = [
        {
          $group: {
            _id: '$type',
            total: {
              $accumulator: {
                init: 'function() { return 0; }',
                accumulate: 'function(s, v) { return s + v; }',
                merge: 'function(a, b) { return a + b; }',
                lang: 'js',
              },
            },
          },
        },
      ];
      expect(scanForDangerousOperators(pipeline).found).toBe(true);
      expect(scanForDangerousOperators(pipeline).operator).toBe('$accumulator');
    });

    it('detects $function inside $addFields pipeline stage', () => {
      const pipeline = [
        {
          $addFields: {
            computed: {
              $function: { body: 'return 1', args: [], lang: 'js' },
            },
          },
        },
      ];
      expect(scanForDangerousOperators(pipeline).found).toBe(true);
      expect(scanForDangerousOperators(pipeline).operator).toBe('$function');
    });

    it('detects dangerous operators inside $facet sub-pipelines', () => {
      const pipeline = [
        {
          $facet: {
            branch1: [
              { $match: { $where: 'true' } },
            ],
          },
        },
      ];
      expect(scanForDangerousOperators(pipeline).found).toBe(true);
      expect(scanForDangerousOperators(pipeline).operator).toBe('$where');
    });

    it('detects dangerous operators inside $lookup sub-pipelines', () => {
      const pipeline = [
        {
          $lookup: {
            from: 'other',
            pipeline: [
              {
                $addFields: {
                  x: { $function: { body: 'bad()', args: [], lang: 'js' } },
                },
              },
            ],
            as: 'joined',
          },
        },
      ];
      expect(scanForDangerousOperators(pipeline).found).toBe(true);
      expect(scanForDangerousOperators(pipeline).operator).toBe('$function');
    });
  });

  describe('case-insensitive blocking', () => {
    it('detects $Where (mixed case)', () => {
      const result = scanForDangerousOperators({ $Where: 'sleep(1)' });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$Where');
    });

    it('detects $FUNCTION (uppercase)', () => {
      const result = scanForDangerousOperators({
        $FUNCTION: { body: '', args: [], lang: 'js' },
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$FUNCTION');
    });

    it('detects $Accumulator (title case)', () => {
      const result = scanForDangerousOperators({
        $Accumulator: { init: '', accumulate: '' },
      });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$Accumulator');
    });

    it('detects $EVAL (uppercase)', () => {
      const result = scanForDangerousOperators({ $EVAL: 'code' });
      expect(result.found).toBe(true);
      expect(result.operator).toBe('$EVAL');
    });
  });

  describe('path reporting', () => {
    it('reports path for top-level operator', () => {
      const result = scanForDangerousOperators({ $where: 'true' });
      expect(result.path).toBe('$where');
    });

    it('reports path for nested operator', () => {
      const result = scanForDangerousOperators({
        $and: [{ $where: 'true' }],
      });
      expect(result.path).toContain('$and');
      expect(result.path).toContain('$where');
    });
  });
});

describe('assertNoDangerousOperators', () => {
  it('does not throw for safe input', () => {
    expect(() => assertNoDangerousOperators({ status: 'active' }, 'query')).not.toThrow();
  });

  it('does not throw for null', () => {
    expect(() => assertNoDangerousOperators(null, 'query')).not.toThrow();
  });

  it('throws for $where with descriptive message', () => {
    expect(() => assertNoDangerousOperators({ $where: 'true' }, 'query')).toThrow(
      /\$where.*blocked.*query/i
    );
  });

  it('throws for $function with context in message', () => {
    expect(() =>
      assertNoDangerousOperators(
        { $expr: { $function: { body: '', args: [], lang: 'js' } } },
        'pipeline'
      )
    ).toThrow(/\$function.*blocked.*pipeline/i);
  });

  it('throws for deeply nested dangerous operator', () => {
    expect(() =>
      assertNoDangerousOperators(
        { $and: [{ $or: [{ $where: 'true' }] }] },
        'filter'
      )
    ).toThrow(/\$where.*blocked.*filter/i);
  });
});
