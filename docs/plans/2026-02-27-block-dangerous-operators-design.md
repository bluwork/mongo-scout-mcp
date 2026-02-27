# Design: Block Dangerous MongoDB Query Operators

**Issue:** #31
**Date:** 2026-02-27
**Status:** Approved

## Problem

No tool blocks MongoDB operators that enable server-side JavaScript execution (`$where`, `$function`, `$accumulator`, `$eval`). These pass through to the MongoDB server even in read-only mode, enabling arbitrary code execution, DoS, and data exfiltration.

## Approach

Standalone validator function in a new `operator-validator.ts` file, integrated at existing chokepoints.

## Blocked Operators

- `$where` — server-side JS in queries
- `$function` — server-side JS in aggregation expressions
- `$accumulator` — server-side JS in `$group`
- `$eval` — deprecated server-side JS command

`$expr` is **allowed** — only the JS execution operators nested within it are blocked.

## New File: `src/utils/operator-validator.ts`

- `DANGEROUS_OPERATORS: string[]` — the blocklist
- `scanForDangerousOperators(obj: unknown): { found: boolean; operator?: string; path?: string }` — recursive deep scan, returns first match with its dot-path
- `assertNoDangerousOperators(obj: unknown, context: string): void` — calls scan, throws descriptive error on match

Case-insensitive matching as defense-in-depth (block `$Where`, `$FUNCTION`, etc.).

## Integration Points

1. **`preprocessQuery()`** — call `assertNoDangerousOperators(query, 'query')` at the top
2. **`validatePipeline()`** — scan each stage body for dangerous operators within expressions
3. **`validateDocuments`** in `data-quality.ts` — scan user-provided `$expr` rule conditions

## Test Coverage (`src/utils/operator-validator.test.ts`)

- Top-level dangerous operators
- Deeply nested inside `$and`/`$or`/`$not`/`$nor` (3+ levels)
- Inside `$expr` expressions
- Inside pipeline stages (`$match`, `$addFields`, `$group`)
- Inside `$facet`/`$lookup` sub-pipeline stages
- Safe operators pass through (`$gt`, `$in`, `$regex`, `$expr`, `$text`)
- Case-insensitive blocking (`$Where`, `$FUNCTION`)
- Empty/null/primitive inputs handled gracefully
