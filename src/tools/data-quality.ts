import type { Collection, Db, Document } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { preprocessQuery } from '../utils/query-preprocessor.js';
import { convertObjectIdsToExtendedJson } from '../utils/sanitize.js';

async function safeAggregate(collection: Collection, pipeline: Document[]): Promise<Document[]> {
  const cursor = collection.aggregate(pipeline);
  try {
    return await cursor.toArray();
  } finally {
    try {
      await cursor.close();
    } catch {
      // Ignore close errors to avoid masking the original error
    }
  }
}

export function registerDataQualityTools(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'findDuplicates',
    'Find duplicate documents based on one or more fields. Useful for data cleanup before adding unique constraints.',
    {
      collection: z.string(),
      fields: z.array(z.string()),
      options: z.object({
        limit: z.number().positive().max(1000).optional(),
        minCount: z.number().int().min(2).optional(),
        sort: z.enum(['count', 'value']).optional(),
        includeDocuments: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('findDuplicates', args);
      const { collection, fields, options = {} } = args;
      const {
        limit = 100,
        minCount = 2,
        sort = 'count',
        includeDocuments = true,
      } = options;

      try {
        const collectionObj = db.collection(collection);

        // Build aggregation pipeline
        const pipeline: any[] = [];

        // Group stage - single field vs composite key
        const groupId = fields.length === 1
          ? `$${fields[0]}`
          : fields.reduce((acc: Record<string, string>, field: string) => {
              acc[field] = `$${field}`;
              return acc;
            }, {} as Record<string, string>);

        const groupStage: any = {
          $group: {
            _id: groupId,
            count: { $sum: 1 },
          },
        };

        // Include documents or just IDs
        if (includeDocuments) {
          groupStage.$group.documents = { $push: '$$ROOT' };
        } else {
          groupStage.$group.documentIds = { $push: '$_id' };
        }

        pipeline.push(groupStage);

        // Filter for duplicates
        pipeline.push({
          $match: {
            count: { $gte: minCount },
          },
        });

        // Sort by count or value
        pipeline.push({
          $sort: sort === 'count' ? { count: -1 } : { _id: 1 },
        });

        // Limit results
        pipeline.push({ $limit: limit });

        // Project final shape
        const projectStage: any = {
          $project: {
            value: '$_id',
            count: 1,
            _id: 0,
          },
        };

        if (includeDocuments) {
          projectStage.$project.documents = { $slice: ['$documents', 5] };
        } else {
          projectStage.$project.documentIds = { $slice: ['$documentIds', 10] };
        }

        pipeline.push(projectStage);

        const duplicateGroups = await collectionObj.aggregate(pipeline, { allowDiskUse: true }).toArray();

        // Calculate statistics
        const totalDocuments = await collectionObj.countDocuments({});
        const affectedDocuments = duplicateGroups.reduce((sum, group) => sum + group.count, 0);
        const uniqueDocuments = totalDocuments - affectedDocuments + duplicateGroups.length;
        const duplicatePercentage = totalDocuments > 0 ? (affectedDocuments / totalDocuments) * 100 : 0;

        // Generate recommendations
        const recommendations: string[] = [];

        if (duplicateGroups.length === 0) {
          recommendations.push('✓ No duplicates found');
        } else {
          if (duplicatePercentage > 10) {
            recommendations.push(`⚠ High duplicate rate (${duplicatePercentage.toFixed(1)}%) - consider data cleanup`);
          }

          if (fields.length === 1 && duplicateGroups.length > 0) {
            recommendations.push(
              `Consider adding unique index: createIndex("${collection}", {${fields[0]}: 1}, {unique: true})`
            );
          }

          if (affectedDocuments > 1000) {
            recommendations.push(
              'Use deleteMany with filter after manual review to clean up duplicates'
            );
          } else if (affectedDocuments > 0) {
            recommendations.push(
              `${affectedDocuments} documents have duplicates - review and clean up as needed`
            );
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  collection,
                  fieldsCombination: fields,
                  totalDuplicateGroups: duplicateGroups.length,
                  affectedDocuments,
                  statistics: {
                    totalDocuments,
                    uniqueDocuments,
                    duplicateDocuments: affectedDocuments,
                    duplicatePercentage: parseFloat(duplicatePercentage.toFixed(2)),
                  },
                  duplicateGroups,
                  recommendations,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('findDuplicates', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding duplicates: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'cloneCollection',
    'Clone a collection with optional filtering and index copying. Supports dryRun mode for preview.',
    {
      source: z.string(),
      destination: z.string(),
      options: z.object({
        filter: z.record(z.any()).optional(),
        includeIndexes: z.boolean().optional(),
        dropIfExists: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        projection: z.record(z.any()).optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('cloneCollection', args);
      const { source, destination, options = {} } = args;
      const {
        filter = {},
        includeIndexes = true,
        dropIfExists = false,
        dryRun = false,
        projection,
      } = options;

      try {
        const warnings: string[] = [];

        // Validate source and destination
        if (source === destination) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: Source and destination cannot be the same collection',
              },
            ],
          };
        }

        // Check if source exists
        const collections = await db.listCollections({ name: source }).toArray();
        if (collections.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Source collection '${source}' does not exist\n\nSuggestion: Use listCollections() to see available collections`,
              },
            ],
          };
        }

        // Check if destination exists
        const destCollections = await db.listCollections({ name: destination }).toArray();
        const destExists = destCollections.length > 0;

        if (destExists && !dropIfExists) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Destination collection '${destination}' already exists\n\nSuggestion: Use dropIfExists: true or choose different name`,
              },
            ],
          };
        }

        if (destExists && dropIfExists) {
          warnings.push(`⚠ Destination collection '${destination}' will be dropped`);
        }

        // Get source stats
        const sourceStats = await db.command({ collStats: source });
        const processedFilter = preprocessQuery(filter);
        const matchCount = await db.collection(source).countDocuments(processedFilter);
        const indexes = await db.collection(source).indexes();

        // Dry run mode
        if (dryRun) {
          const estimatedSize = matchCount > 0
            ? Math.floor(sourceStats.size * (matchCount / sourceStats.count))
            : 0;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    dryRun: true,
                    source: {
                      collection: source,
                      documentCount: sourceStats.count,
                      documentsToCopy: matchCount,
                      sizeBytes: sourceStats.size,
                      indexes: indexes.length,
                    },
                    destination: {
                      collection: destination,
                      existed: destExists,
                      willDrop: destExists && dropIfExists,
                      estimatedSize,
                    },
                    warnings,
                    estimatedTimeMs: Math.floor(matchCount / 1000) * 100,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const startTime = Date.now();

        // Drop destination if it exists
        if (destExists && dropIfExists) {
          await db.collection(destination).drop();
        }

        // Clone using aggregation $out for efficiency
        const pipeline: any[] = [{ $match: processedFilter }];

        if (projection) {
          pipeline.push({ $project: projection });
        }

        pipeline.push({ $out: destination });

        await db.collection(source).aggregate(pipeline).toArray();

        let indexesCopied = 0;

        // Copy indexes
        if (includeIndexes) {
          for (const index of indexes) {
            if (index.name === '_id_') continue; // Skip default _id index

            const indexSpec = index.key;
            const indexOptions: any = {
              name: index.name,
            };

            if (index.unique) indexOptions.unique = true;
            if (index.sparse) indexOptions.sparse = true;
            if (index.expireAfterSeconds !== undefined) {
              indexOptions.expireAfterSeconds = index.expireAfterSeconds;
            }

            try {
              await db.collection(destination).createIndex(indexSpec, indexOptions);
              indexesCopied++;
            } catch (err) {
              // Index creation might fail if projection removed indexed fields
              warnings.push(`Failed to copy index '${index.name}': ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        const executionTimeMs = Date.now() - startTime;
        const destStats = await db.command({ collStats: destination });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  source: { collection: source, documentCount: sourceStats.count },
                  destination: {
                    collection: destination,
                    documentsCopied: destStats.count,
                    indexesCopied,
                    sizeBytes: destStats.size,
                  },
                  executionTimeMs,
                  warnings: warnings.length > 0 ? warnings : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('cloneCollection', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error cloning collection: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'exportCollection',
    'Export collection data to JSON, JSONL, or CSV format. Returns data directly or saves to file if output path provided.',
    {
      collection: z.string(),
      options: z.object({
        format: z.enum(['json', 'jsonl', 'csv']).optional(),
        filter: z.record(z.any()).optional(),
        projection: z.record(z.any()).optional(),
        limit: z.number().positive().optional(),
        sort: z.record(z.number()).optional(),
        flatten: z.boolean().optional(),
        pretty: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('exportCollection', args);
      const { collection, options = {} } = args;
      const {
        format = 'json',
        filter = {},
        projection,
        limit,
        sort,
        flatten = true,
        pretty = false,
      } = options;

      try {
        const warnings: string[] = [];
        const processedFilter = preprocessQuery(filter);

        // Get documents
        let cursor = db.collection(collection).find(processedFilter);

        if (projection) cursor = cursor.project(projection);
        if (sort) cursor = cursor.sort(sort);
        if (limit) cursor = cursor.limit(limit);

        const documents = await cursor.toArray();

        if (documents.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  documentsExported: 0,
                  message: 'No documents match filter',
                  suggestion: 'Check filter criteria or use find() to verify data exists',
                }), null, 2),
              },
            ],
          };
        }

        const startTime = Date.now();
        let data: string;
        let sizeBytes: number;

        switch (format) {
          case 'json': {
            const convertedDocs = convertObjectIdsToExtendedJson(documents);
            data = pretty
              ? JSON.stringify(convertedDocs, null, 2)
              : JSON.stringify(convertedDocs);
            sizeBytes = Buffer.byteLength(data, 'utf8');
            break;
          }

          case 'jsonl': {
            data = documents.map(doc => JSON.stringify(convertObjectIdsToExtendedJson(doc))).join('\n');
            sizeBytes = Buffer.byteLength(data, 'utf8');
            break;
          }

          case 'csv': {
            const convertedDocs = documents.map(doc => convertObjectIdsToExtendedJson(doc) as Record<string, any>);
            const processedDocs = flatten
              ? convertedDocs.map(doc => flattenObject(doc))
              : convertedDocs;

            // Get all unique headers
            const headersSet = new Set<string>();
            processedDocs.forEach(doc => {
              Object.keys(doc as any).forEach(key => headersSet.add(key));
            });
            const headers = Array.from(headersSet);

            // Build CSV
            const csvRows: string[] = [];
            csvRows.push(headers.join(','));

            for (const doc of processedDocs) {
              const row = headers.map(header => {
                const value = (doc as any)[header];

                if (value === null || value === undefined) {
                  return '';
                }
                if (typeof value === 'object') {
                  return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
                }
                if (typeof value === 'string') {
                  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                  }
                  return value;
                }
                return String(value);
              });

              csvRows.push(row.join(','));
            }

            data = csvRows.join('\n');
            sizeBytes = Buffer.byteLength(data, 'utf8');

            // Check for nested structures in non-flatten mode
            if (!flatten && documents.some(doc =>
              Object.values(doc).some(val =>
                typeof val === 'object' && val !== null && !(val instanceof Date)
              )
            )) {
              warnings.push('⚠ Document contains nested objects. Consider using flatten: true for better CSV compatibility');
            }
            break;
          }

          default:
            throw new Error(`Unsupported format: ${format}`);
        }

        const executionTimeMs = Date.now() - startTime;

        // Warn for large exports
        if (sizeBytes > 1000000) { // > 1MB
          warnings.push('⚠ Large export - consider saving to file or using limit parameter');
        }

        const result: any = {
          collection,
          format,
          documentsExported: documents.length,
          sizeBytes,
          executionTimeMs,
        };

        if (warnings.length > 0) {
          result.warnings = warnings;
        }

        // For reasonable sizes, include the data
        if (sizeBytes <= 100000) { // <= 100KB
          result.data = format === 'json' ? documents : data;
        } else {
          result.preview = data.substring(0, 200) + '...';
          result.message = 'Data too large to display. Use limit parameter to reduce size.';
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(result), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('exportCollection', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error exporting collection: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'findMissingFields',
    'Check which documents are missing specified required fields. Useful for schema validation before migrations.',
    {
      collection: z.string(),
      requiredFields: z.array(z.string()),
      options: z.object({
        filter: z.record(z.any()).optional(),
        sampleSize: z.number().positive().optional(),
        includeDocuments: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('findMissingFields', args);
      const { collection, requiredFields, options = {} } = args;
      const { filter = {}, sampleSize, includeDocuments = true } = options;

      try {
        const processedFilter = preprocessQuery(filter);
        const collectionObj = db.collection(collection);

        // Get total documents to check
        const totalDocuments = sampleSize
          ? Math.min(sampleSize, await collectionObj.countDocuments(processedFilter))
          : await collectionObj.countDocuments(processedFilter);

        if (totalDocuments === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  message: 'No documents found matching filter',
                }), null, 2),
              },
            ],
          };
        }

        const missingFieldCounts: Record<string, any> = {};

        // Check each field
        for (const field of requiredFields) {
          const missingFilter = {
            ...processedFilter,
            [field]: { $exists: false },
          };

          const missingCount = await collectionObj.countDocuments(missingFilter);

          missingFieldCounts[field] = {
            missing: missingCount,
            percentage: parseFloat(((missingCount / totalDocuments) * 100).toFixed(2)),
          };

          // Get sample documents if requested
          if (includeDocuments && missingCount > 0) {
            const samples = await collectionObj
              .find(missingFilter)
              .limit(3)
              .toArray();

            missingFieldCounts[field].sampleDocuments = samples;
          }
        }

        // Calculate statistics
        const documentsMissingAnyField = await collectionObj.countDocuments({
          ...processedFilter,
          $or: requiredFields.map((field: string) => ({ [field]: { $exists: false } })),
        });

        const documentsComplete = totalDocuments - documentsMissingAnyField;
        const completionRate = parseFloat((documentsComplete / totalDocuments).toFixed(4));

        // Generate recommendations
        const recommendations: string[] = [];

        Object.entries(missingFieldCounts).forEach(([field, stats]) => {
          if (stats.percentage > 50) {
            recommendations.push(
              `⚠ Field '${field}' missing in ${stats.percentage}% of documents - consider making it optional or running migration`
            );
          } else if (stats.percentage > 10) {
            recommendations.push(
              `Field '${field}' missing in ${stats.missing} documents - use updateMany to set default values`
            );
          } else if (stats.missing > 0 && stats.percentage < 1) {
            recommendations.push(
              `Field '${field}' missing in ${stats.missing} documents - investigate and fix individually`
            );
          }
        });

        if (completionRate === 1.0) {
          recommendations.push('✓ All documents have all required fields');
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  totalDocuments,
                  requiredFields,
                  missingFieldCounts,
                  documentsMissingAnyField,
                  documentsComplete,
                  completionRate,
                  recommendations,
                }), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('findMissingFields', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding missing fields: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'findInconsistentTypes',
    'Detect type inconsistencies in a field across documents. Helps identify data quality issues.',
    {
      collection: z.string(),
      field: z.string(),
      options: z.object({
        filter: z.record(z.any()).optional(),
        sampleSize: z.number().positive().optional(),
        includeSamples: z.boolean().optional(),
        samplesPerType: z.number().positive().max(10).optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('findInconsistentTypes', args);
      const { collection, field, options = {} } = args;
      const {
        filter = {},
        sampleSize,
        includeSamples = true,
        samplesPerType = 3,
      } = options;

      try {
        const processedFilter = preprocessQuery(filter);
        const collectionObj = db.collection(collection);

        // Build aggregation pipeline
        const pipeline: any[] = [{ $match: processedFilter }];

        if (sampleSize) {
          pipeline.push({ $limit: sampleSize });
        }

        // Determine type for each document
        pipeline.push({
          $project: {
            fieldValue: `$${field}`,
            fieldType: {
              $switch: {
                branches: [
                  { case: { $eq: [{ $type: `$${field}` }, 'missing'] }, then: 'missing' },
                  { case: { $eq: [{ $type: `$${field}` }, 'null'] }, then: 'null' },
                  { case: { $isArray: `$${field}` }, then: 'array' },
                  { case: { $eq: [{ $type: `$${field}` }, 'objectId'] }, then: 'ObjectId' },
                  { case: { $eq: [{ $type: `$${field}` }, 'date'] }, then: 'Date' },
                  { case: { $eq: [{ $type: `$${field}` }, 'bool'] }, then: 'boolean' },
                  { case: { $eq: [{ $type: `$${field}` }, 'int'] }, then: 'number' },
                  { case: { $eq: [{ $type: `$${field}` }, 'long'] }, then: 'number' },
                  { case: { $eq: [{ $type: `$${field}` }, 'double'] }, then: 'number' },
                  { case: { $eq: [{ $type: `$${field}` }, 'decimal'] }, then: 'number' },
                  { case: { $eq: [{ $type: `$${field}` }, 'string'] }, then: 'string' },
                  { case: { $eq: [{ $type: `$${field}` }, 'object'] }, then: 'object' },
                ],
                default: 'unknown',
              },
            },
          },
        });

        // Group by type
        pipeline.push({
          $group: {
            _id: '$fieldType',
            count: { $sum: 1 },
            samples: { $push: '$fieldValue' },
          },
        });

        // Sort by count descending
        pipeline.push({ $sort: { count: -1 } });

        const results = await safeAggregate(collectionObj, pipeline);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  field,
                  message: 'No documents found matching filter',
                }), null, 2),
              },
            ],
          };
        }

        // Calculate totals
        const totalDocuments = results.reduce((sum, r) => sum + r.count, 0);

        // Build type map
        const types: Record<string, any> = {};
        results.forEach(result => {
          const typeName = result._id;
          types[typeName] = {
            count: result.count,
            percentage: parseFloat(((result.count / totalDocuments) * 100).toFixed(2)),
          };

          if (includeSamples) {
            types[typeName].samples = result.samples.slice(0, samplesPerType);
          }
        });

        // Find dominant type
        const dominantType = results[0]
          ? {
              type: results[0]._id,
              count: results[0].count,
              percentage: parseFloat(((results[0].count / totalDocuments) * 100).toFixed(2)),
            }
          : null;

        const isConsistent = results.length === 1;

        // Generate recommendations
        const recommendations = generateTypeRecommendations(types, dominantType, field);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  field,
                  totalDocuments,
                  isConsistent,
                  types,
                  dominantType,
                  recommendations,
                }), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('findInconsistentTypes', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding type inconsistencies: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'renameField',
    'Rename a field across documents in a collection. Supports filtering, dry-run mode, and index migration.',
    {
      collection: z.string(),
      oldFieldName: z.string(),
      newFieldName: z.string(),
      options: z.object({
        filter: z.record(z.any()).optional(),
        dryRun: z.boolean().optional(),
        createIndex: z.boolean().optional(),
        dropOldIndex: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('renameField', args);
      const { collection, oldFieldName, newFieldName, options = {} } = args;
      const {
        filter = {},
        dryRun = false,
        createIndex = true,
        dropOldIndex = false,
      } = options;

      try {
        const warnings: string[] = [];
        const collectionObj = db.collection(collection);

        // Build filter that only matches documents with the old field
        const renameFilter = {
          ...preprocessQuery(filter),
          [oldFieldName]: { $exists: true },
        };

        // Count affected documents
        const affectedCount = await collectionObj.countDocuments(renameFilter);

        if (affectedCount === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  documentsAffected: 0,
                  message: `No documents found with field '${oldFieldName}'`,
                  suggestion: 'Check field name spelling or use find() to verify data',
                }, null, 2),
              },
            ],
          };
        }

        // Dry run mode
        if (dryRun) {
          const samples = await collectionObj.find(renameFilter).limit(3).toArray();

          const beforeAfter = samples.map(doc => {
            const before = { ...doc };
            const after = { ...doc };
            after[newFieldName] = doc[oldFieldName];
            delete after[oldFieldName];

            return { before, after };
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                    dryRun: true,
                    collection,
                    oldFieldName,
                    newFieldName,
                    documentsAffected: affectedCount,
                    samples: beforeAfter,
                    estimatedTimeMs: Math.ceil(affectedCount / 1000) * 100,
                  }), null, 2),
              },
            ],
          };
        }

        // Check if new field already exists
        const conflictCount = await collectionObj.countDocuments({
          ...renameFilter,
          [newFieldName]: { $exists: true },
        });

        if (conflictCount > 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Field '${newFieldName}' already exists in ${conflictCount} documents\n\nSuggestion: Choose different name or manually resolve conflicts`,
              },
            ],
          };
        }

        // Execute rename
        const startTime = Date.now();

        const result = await collectionObj.updateMany(renameFilter, {
          $rename: { [oldFieldName]: newFieldName },
        });

        const executionTimeMs = Date.now() - startTime;

        // Handle indexes
        let indexesUpdated = 0;
        if (createIndex) {
          const indexes = await collectionObj.indexes();
          const oldFieldIndexes = indexes.filter(idx =>
            Object.keys(idx.key).includes(oldFieldName)
          );

          for (const oldIndex of oldFieldIndexes) {
            // Skip if index doesn't have a name
            if (!oldIndex.name) continue;

            // Create new index with new field name
            const newKey = { ...oldIndex.key };
            newKey[newFieldName] = newKey[oldFieldName];
            delete newKey[oldFieldName];

            const indexOptions: any = {
              name: oldIndex.name.replace(oldFieldName, newFieldName),
            };

            if (oldIndex.unique) indexOptions.unique = true;
            if (oldIndex.sparse) indexOptions.sparse = true;

            try {
              await collectionObj.createIndex(newKey, indexOptions);
              indexesUpdated++;

              // Optionally drop old index
              if (dropOldIndex) {
                await collectionObj.dropIndex(oldIndex.name);
              }
            } catch (err) {
              warnings.push(
                `Failed to migrate index '${oldIndex.name}': ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }

          if (indexesUpdated > 0 && !dropOldIndex) {
            warnings.push(
              `Created ${indexesUpdated} new indexes. Old indexes still exist - use dropOldIndex: true to remove them`
            );
          }
        }

        if (affectedCount > 100000) {
          warnings.push('⚠ Large operation completed - consider running during off-peak hours for future migrations');
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  oldFieldName,
                  newFieldName,
                  documentsAffected: result.modifiedCount,
                  indexesUpdated,
                  executionTimeMs,
                  warnings: warnings.length > 0 ? warnings : undefined,
                }), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('renameField', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error renaming field: ${errorMessage}`,
            },
          ],
        };
      }
    },
    true
  );

  registerTool(
    'analyzeQueryPerformance',
    'Analyze query performance using MongoDB explain plan. Identifies index usage, slow queries, and optimization opportunities.',
    {
      collection: z.string(),
      query: z.object({
        filter: z.record(z.any()).optional(),
        sort: z.record(z.number()).optional(),
        projection: z.record(z.any()).optional(),
        limit: z.number().optional(),
      }).optional(),
      options: z.object({
        verbosity: z.enum(['queryPlanner', 'executionStats', 'allPlansExecution']).optional(),
        includeRecommendations: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('analyzeQueryPerformance', args);
      const { collection, query = {}, options = {} } = args;
      const {
        filter = {},
        sort,
        projection,
        limit,
      } = query;
      const {
        verbosity = 'executionStats',
        includeRecommendations = true,
      } = options;

      try {
        const collectionObj = db.collection(collection);
        const processedFilter = preprocessQuery(filter);

        // Build query
        let cursor = collectionObj.find(processedFilter);
        if (projection) cursor = cursor.project(projection);
        if (sort) cursor = cursor.sort(sort);
        if (limit) cursor = cursor.limit(limit);

        // Get explain output
        const explain = await cursor.explain(verbosity);

        // Extract key metrics based on verbosity level
        const analysis: any = {
          collection,
          query: {
            filter: processedFilter,
            sort,
            projection,
            limit,
          },
        };

        // Always available from queryPlanner
        if (explain.queryPlanner) {
          analysis.planSummary = {
            namespace: explain.queryPlanner.namespace,
            indexFilterSet: explain.queryPlanner.indexFilterSet || false,
            winningPlan: simplifyPlanTree(explain.queryPlanner.winningPlan),
          };
        }

        // Available from executionStats and allPlansExecution
        if (explain.executionStats) {
          const stats = explain.executionStats;
          analysis.executionStats = {
            executionTimeMs: stats.executionTimeMillis,
            totalDocsExamined: stats.totalDocsExamined,
            totalKeysExamined: stats.totalKeysExamined,
            nReturned: stats.nReturned,
            executionStages: simplifyExecutionStages(stats.executionStages),
          };

          // Calculate efficiency metrics
          const selectivity = stats.nReturned > 0
            ? (stats.totalDocsExamined / stats.nReturned).toFixed(2)
            : 'N/A';

          analysis.efficiency = {
            indexUsed: stats.totalKeysExamined > 0,
            selectivityRatio: selectivity,
            isCollectionScan: stats.executionStages?.stage === 'COLLSCAN',
          };

          if (stats.allPlansExecution && verbosity === 'allPlansExecution') {
            analysis.alternativePlans = stats.allPlansExecution.map((plan: any) => ({
              planSummary: simplifyPlanTree(plan),
            }));
          }
        }

        // Get current indexes for context
        const indexes = await collectionObj.indexes();
        analysis.availableIndexes = indexes.map(idx => ({
          name: idx.name,
          key: idx.key,
          unique: idx.unique || false,
          sparse: idx.sparse || false,
        }));

        // Generate recommendations
        if (includeRecommendations) {
          analysis.recommendations = generatePerformanceRecommendations(
            explain,
            processedFilter,
            sort
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson(analysis), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('analyzeQueryPerformance', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error analyzing query performance: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'findOrphans',
    'Find orphaned documents where referenced IDs no longer exist in the target collection. Essential for maintaining referential integrity.',
    {
      collection: z.string(),
      foreignKey: z.string(),
      referenceCollection: z.string(),
      options: z.object({
        referenceField: z.string().optional(),
        filter: z.record(z.any()).optional(),
        limit: z.number().positive().max(1000).optional(),
        includeDocuments: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('findOrphans', args);
      const { collection, foreignKey, referenceCollection, options = {} } = args;
      const {
        referenceField = '_id',
        filter = {},
        limit = 100,
        includeDocuments = true,
      } = options;

      try {
        const collectionObj = db.collection(collection);

        // Check if reference collection exists
        const refCollections = await db.listCollections({ name: referenceCollection }).toArray();
        if (refCollections.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Reference collection '${referenceCollection}' does not exist`,
                  suggestion: 'Use listCollections() to see available collections',
                }, null, 2),
              },
            ],
          };
        }

        const processedFilter = preprocessQuery(filter);
        const startTime = Date.now();

        // Build aggregation pipeline to find orphans
        const pipeline: any[] = [
          {
            $match: {
              ...processedFilter,
              [foreignKey]: { $exists: true, $ne: null },
            },
          },
          {
            $lookup: {
              from: referenceCollection,
              localField: foreignKey,
              foreignField: referenceField,
              as: 'referenced',
            },
          },
          {
            $match: {
              referenced: { $size: 0 }, // No matching documents in reference collection
            },
          },
          {
            $limit: limit,
          },
        ];

        if (!includeDocuments) {
          pipeline.push({
            $project: {
              _id: 1,
              [foreignKey]: 1,
            },
          });
        } else {
          pipeline.push({
            $project: {
              referenced: 0, // Remove the lookup result field
            },
          });
        }

        const orphans = await safeAggregate(collectionObj, pipeline);

        // Count total orphans (without limit)
        const countPipeline = pipeline.slice(0, -2); // Remove limit and project
        countPipeline.push({ $count: 'total' });
        const countResult = await safeAggregate(collectionObj, countPipeline);
        const totalOrphans = countResult.length > 0 ? countResult[0].total : 0;

        const executionTimeMs = Date.now() - startTime;

        // Get collection stats
        const totalDocuments = await collectionObj.countDocuments(processedFilter);
        const orphanPercentage = totalDocuments > 0
          ? parseFloat(((totalOrphans / totalDocuments) * 100).toFixed(2))
          : 0;

        // Generate recommendations
        const recommendations: string[] = [];

        if (totalOrphans === 0) {
          recommendations.push('✓ No orphaned references found - referential integrity is maintained');
        } else {
          if (orphanPercentage > 10) {
            recommendations.push(
              `⚠ High orphan rate (${orphanPercentage}%) - consider implementing cascade delete or fixing data relationships`
            );
          }

          if (totalOrphans < 100) {
            recommendations.push(
              `Found ${totalOrphans} orphaned documents - use deleteMany or updateMany to clean up`
            );
          } else {
            recommendations.push(
              `Found ${totalOrphans} orphaned documents - implement batch cleanup process for safe removal`
            );
          }

          recommendations.push(
            `Consider adding validation or triggers to prevent orphaned references in future`
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  collection,
                  foreignKey,
                  referenceCollection,
                  referenceField,
                  totalOrphans,
                  orphansReturned: orphans.length,
                  statistics: {
                    totalDocuments,
                    orphanedDocuments: totalOrphans,
                    orphanPercentage,
                  },
                  orphans: includeDocuments ? orphans : orphans.map(o => ({ _id: o._id, [foreignKey]: o[foreignKey] })),
                  executionTimeMs,
                  recommendations,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('findOrphans', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding orphans: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'exploreRelationships',
    'Explore document relationships by following foreign key references in both directions. Useful for understanding data dependencies and debugging related entities.',
    {
      collection: z.string(),
      documentId: z.string().optional(),
      filter: z.record(z.any()).optional(),
      relationships: z.array(z.object({
        localField: z.string(),
        foreignCollection: z.string(),
        foreignField: z.string(),
        as: z.string().optional(),
      })),
      options: z.object({
        depth: z.number().int().min(1).max(5).optional(),
        includeReverse: z.boolean().optional(),
        limit: z.number().positive().max(100).optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('exploreRelationships', args);
      const { collection, documentId, filter, relationships, options = {} } = args;
      const {
        depth = 1,
        includeReverse = false,
        limit = 10,
      } = options;

      try {
        // Validate that either documentId or filter is provided
        if (!documentId && !filter) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  error: 'Either documentId or filter must be provided',
                  suggestion: 'Use documentId for single document or filter for multiple documents',
                }), null, 2),
              },
            ],
          };
        }

        const collectionObj = db.collection(collection);
        const startTime = Date.now();

        let rootFilter: any;
        if (documentId) {
          const processedId = preprocessQuery({ _id: documentId })._id;

          if (processedId === documentId) {
            const numericId = Number(documentId);
            if (!isNaN(numericId) && Number.isFinite(numericId)) {
              rootFilter = { $or: [{ _id: numericId }, { _id: documentId }] };
            } else {
              rootFilter = { _id: documentId };
            }
          } else {
            rootFilter = { _id: processedId };
          }
        } else {
          rootFilter = preprocessQuery(filter!);
        }

        // Get root document(s)
        const rootDocuments = await collectionObj.find(rootFilter).limit(limit).toArray();

        if (rootDocuments.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  message: 'No documents found matching the criteria',
                  suggestion: 'Check documentId or filter criteria',
                }), null, 2),
              },
            ],
          };
        }

        // Explore relationships for each root document
        const results = [];
        for (const rootDoc of rootDocuments) {
          const explored = await exploreDocumentRelationships(
            db,
            collection,
            rootDoc,
            relationships,
            depth,
            includeReverse
          );
          results.push(explored);
        }

        const executionTimeMs = Date.now() - startTime;

        // Generate statistics
        const totalRelated = results.reduce((sum, r) => {
          return sum + Object.keys(r.related || {}).reduce((s, key) => {
            return s + (Array.isArray(r.related[key]) ? r.related[key].length : 1);
          }, 0);
        }, 0);

        const totalReverse = includeReverse
          ? results.reduce((sum, r) => {
              return sum + Object.keys(r.reverseReferences || {}).reduce((s, key) => {
                return s + (Array.isArray(r.reverseReferences[key]) ? r.reverseReferences[key].length : 0);
              }, 0);
            }, 0)
          : 0;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  collection,
                  documentsExplored: results.length,
                  statistics: {
                    totalRelatedDocuments: totalRelated,
                    totalReverseReferences: totalReverse,
                    executionTimeMs,
                  },
                  results: results.length === 1 ? results[0] : results,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logError('exploreRelationships', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error exploring relationships: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'validateDocuments',
    'Validate documents against custom rules using MongoDB $expr conditions. Generic validation framework for any business logic or data consistency checks.',
    {
      collection: z.string(),
      rules: z.array(z.object({
        name: z.string(),
        condition: z.record(z.any()),
        message: z.string(),
        severity: z.enum(['error', 'warning', 'info']).optional(),
      })),
      options: z.object({
        filter: z.record(z.any()).optional(),
        limit: z.number().positive().max(10000).optional(),
        includeValid: z.boolean().optional(),
        stopOnFirst: z.boolean().optional(),
      }).optional(),
    },
    async (args) => {
      logToolUsage('validateDocuments', args);
      const { collection, rules, options = {} } = args;
      const {
        filter = {},
        limit = 1000,
        includeValid = false,
        stopOnFirst = false,
      } = options;

      try {
        const collectionObj = db.collection(collection);
        const processedFilter = preprocessQuery(filter);
        const startTime = Date.now();

        const totalDocuments = await collectionObj.countDocuments(processedFilter);

        if (totalDocuments === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(convertObjectIdsToExtendedJson({
                  collection,
                  message: 'No documents found matching filter',
                }), null, 2),
              },
            ],
          };
        }

        const violations: any[] = [];
        const validDocuments: any[] = [];
        let documentsChecked = 0;

        for (const rule of rules) {
          if (!rule.condition.$expr) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Validation rule '${rule.name}' must use $expr condition format. Non-$expr conditions are not supported.`,
                },
              ],
            };
          }

          const pipeline = [
            { $match: processedFilter },
            { $limit: limit },
            {
              $match: {
                $expr: { $not: rule.condition.$expr },
              },
            },
          ];

          const violatingDocs = await safeAggregate(collectionObj, pipeline);

          if (violatingDocs.length > 0) {
            violations.push({
              rule: rule.name,
              message: rule.message,
              severity: rule.severity || 'error',
              violationCount: violatingDocs.length,
              samples: violatingDocs.slice(0, 5), // Show first 5 violations
            });

            if (stopOnFirst) {
              break;
            }
          }

          documentsChecked = Math.max(documentsChecked, violatingDocs.length);
        }

        // Optionally check for valid documents
        if (includeValid && violations.length === 0) {
          const sampleValid = await collectionObj.find(processedFilter).limit(3).toArray();
          validDocuments.push(...sampleValid);
        }

        const executionTimeMs = Date.now() - startTime;

        // Generate summary
        const summary = {
          collection,
          totalDocuments,
          documentsChecked: Math.min(limit, totalDocuments),
          rulesChecked: rules.length,
          totalViolations: violations.length,
          violationsByRule: violations.reduce((acc: any, v: any) => {
            acc[v.rule] = v.violationCount;
            return acc;
          }, {}),
        };

        // Generate recommendations
        const recommendations: string[] = [];

        if (violations.length === 0) {
          recommendations.push('✓ All documents passed validation rules');
        } else {
          const errorCount = violations.filter((v: any) => v.severity === 'error').length;
          const warningCount = violations.filter((v: any) => v.severity === 'warning').length;

          if (errorCount > 0) {
            recommendations.push(`⚠ Found ${errorCount} error-level validation failures`);
          }
          if (warningCount > 0) {
            recommendations.push(`Found ${warningCount} warning-level validation issues`);
          }

          const totalViolatingDocs = violations.reduce((sum: number, v: any) => sum + v.violationCount, 0);
          const violationPercentage = ((totalViolatingDocs / totalDocuments) * 100).toFixed(2);

          if (parseFloat(violationPercentage) > 10) {
            recommendations.push(
              `High violation rate (${violationPercentage}%) - consider data migration or schema changes`
            );
          }

          recommendations.push(
            'Review samples and use updateMany with dryRun to preview fixes'
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(convertObjectIdsToExtendedJson({
                  summary,
                  violations,
                  validSamples: includeValid ? validDocuments : undefined,
                  recommendations,
                  executionTimeMs,
                }), null, 2),
            },
          ],
        };
      } catch (error) {
        logError('validateDocuments', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error validating documents: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}

// Helper function to explore document relationships recursively
async function exploreDocumentRelationships(
  db: Db,
  rootCollection: string,
  rootDoc: any,
  relationships: Array<{
    localField: string;
    foreignCollection: string;
    foreignField: string;
    as?: string;
  }>,
  depth: number,
  includeReverse: boolean,
  visited: Set<string> = new Set()
): Promise<any> {
  const docKey = `${rootCollection}:${rootDoc._id}`;

  // Prevent circular references
  if (visited.has(docKey)) {
    return { document: rootDoc, circular: true };
  }
  visited.add(docKey);

  const result: any = {
    document: rootDoc,
    related: {},
  };

  // Follow forward relationships
  for (const rel of relationships) {
    const fieldValue = rootDoc[rel.localField];
    if (!fieldValue) continue;

    const alias = rel.as || rel.foreignCollection;
    const foreignColl = db.collection(rel.foreignCollection);

    // Handle arrays vs single values
    const foreignIds = Array.isArray(fieldValue) ? fieldValue : [fieldValue];

    const relatedDocs = await foreignColl
      .find({ [rel.foreignField]: { $in: foreignIds } })
      .limit(100)
      .toArray();

    if (relatedDocs.length > 0) {
      // If depth > 1, recursively explore related documents
      if (depth > 1) {
        const explored = [];
        for (const doc of relatedDocs) {
          const nested = await exploreDocumentRelationships(
            db,
            rel.foreignCollection,
            doc,
            relationships,
            depth - 1,
            false, // Don't include reverse at nested levels
            visited
          );
          explored.push(nested);
        }
        result.related[alias] = Array.isArray(fieldValue) ? explored : explored[0];
      } else {
        result.related[alias] = Array.isArray(fieldValue) ? relatedDocs : relatedDocs[0];
      }
    }
  }

  // Find reverse references (documents that reference this one)
  if (includeReverse) {
    result.reverseReferences = {};

    for (const rel of relationships) {
      const foreignColl = db.collection(rel.foreignCollection);

      // Find documents in foreign collection that reference this document
      const reverseFilter = {
        [rel.localField]: rootDoc[rel.foreignField] || rootDoc._id,
      };

      const referencingDocs = await foreignColl
        .find(reverseFilter)
        .limit(50)
        .toArray();

      if (referencingDocs.length > 0) {
        const alias = `${rel.foreignCollection}_referencing`;
        result.reverseReferences[alias] = referencingDocs;
      }
    }
  }

  return result;
}

// Helper function to generate type consistency recommendations
function generateTypeRecommendations(
  types: Record<string, any>,
  dominantType: any,
  field: string
): string[] {
  const recommendations: string[] = [];
  const typeNames = Object.keys(types);

  if (typeNames.length === 1) {
    recommendations.push(`✓ Field '${field}' has consistent type: ${typeNames[0]}`);
    return recommendations;
  }

  // Multiple types detected
  recommendations.push(`⚠ Field '${field}' has ${typeNames.length} different types`);

  // Check for common issues
  if (types.string && types.number) {
    const stringPct = types.string.percentage;
    const numberPct = types.number.percentage;

    if (stringPct < numberPct) {
      recommendations.push(
        `Convert ${types.string.count} string values to numbers using updateMany with $toDouble`
      );
    } else {
      recommendations.push(
        `Consider standardizing to string or investigate why ${types.number.count} docs have numbers`
      );
    }
  }

  if (types.missing) {
    recommendations.push(
      `${types.missing.count} documents missing field '${field}' - consider setting default value or making field optional`
    );
  }

  if (types.null) {
    recommendations.push(
      `${types.null.count} documents have null value - determine if intentional or should be removed`
    );
  }

  if (types.array && (types.string || types.number)) {
    recommendations.push(
      '⚠ Mix of scalar and array values - this will cause query issues. Normalize to consistent structure'
    );
  }

  // Suggest dominant type conversion
  if (dominantType && dominantType.percentage > 80) {
    const minorityTypes = typeNames.filter(t => t !== dominantType.type);
    recommendations.push(
      `Dominant type is ${dominantType.type} (${dominantType.percentage}%). Consider converting ${minorityTypes.join(', ')} to ${dominantType.type}`
    );
  }

  return recommendations;
}

// Helper function to flatten nested objects for CSV export
function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const flattened: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      flattened[newKey] = value;
    } else if (Array.isArray(value)) {
      // Convert arrays to JSON string for CSV
      flattened[newKey] = JSON.stringify(value);
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      // Check for ObjectId and other MongoDB types
      if (value.constructor.name === 'ObjectId') {
        flattened[newKey] = value.toString();
      } else {
        // Recursively flatten nested objects
        Object.assign(flattened, flattenObject(value, newKey));
      }
    } else {
      flattened[newKey] = value;
    }
  }

  return flattened;
}

// Helper function to simplify explain plan tree for readability
function simplifyPlanTree(plan: any): any {
  if (!plan) return null;

  const simplified: any = {
    stage: plan.stage,
  };

  // Include relevant fields based on stage type
  if (plan.indexName) simplified.indexName = plan.indexName;
  if (plan.direction) simplified.direction = plan.direction;
  if (plan.indexBounds) simplified.indexBounds = plan.indexBounds;
  if (plan.filter) simplified.filter = plan.filter;

  // Recursively simplify input stages
  if (plan.inputStage) {
    simplified.inputStage = simplifyPlanTree(plan.inputStage);
  }
  if (plan.inputStages) {
    simplified.inputStages = plan.inputStages.map((stage: any) => simplifyPlanTree(stage));
  }

  return simplified;
}

// Helper function to simplify execution stages
function simplifyExecutionStages(stages: any): any {
  if (!stages) return null;

  const simplified: any = {
    stage: stages.stage,
  };

  // Include execution metrics
  if (stages.nReturned !== undefined) simplified.nReturned = stages.nReturned;
  if (stages.executionTimeMillisEstimate !== undefined) {
    simplified.executionTimeMillisEstimate = stages.executionTimeMillisEstimate;
  }
  if (stages.works !== undefined) simplified.works = stages.works;
  if (stages.advanced !== undefined) simplified.advanced = stages.advanced;
  if (stages.docsExamined !== undefined) simplified.docsExamined = stages.docsExamined;

  // Stage-specific fields
  if (stages.indexName) simplified.indexName = stages.indexName;
  if (stages.keysExamined !== undefined) simplified.keysExamined = stages.keysExamined;
  if (stages.seeks !== undefined) simplified.seeks = stages.seeks;

  // Recursively simplify input stages
  if (stages.inputStage) {
    simplified.inputStage = simplifyExecutionStages(stages.inputStage);
  }
  if (stages.inputStages) {
    simplified.inputStages = stages.inputStages.map((stage: any) => simplifyExecutionStages(stage));
  }

  return simplified;
}

// Helper function to generate performance recommendations
function generatePerformanceRecommendations(
  explain: any,
  filter: any,
  sort: any
): string[] {
  const recommendations: string[] = [];

  if (!explain.executionStats) {
    recommendations.push('Run with verbosity "executionStats" or "allPlansExecution" for detailed recommendations');
    return recommendations;
  }

  const stats = explain.executionStats;
  const isCollectionScan = stats.executionStages?.stage === 'COLLSCAN';
  const totalDocsExamined = stats.totalDocsExamined || 0;
  const totalKeysExamined = stats.totalKeysExamined || 0;
  const nReturned = stats.nReturned || 0;
  const executionTimeMs = stats.executionTimeMillis || 0;

  // Check for collection scan
  if (isCollectionScan) {
    const filterFields = Object.keys(filter);
    if (filterFields.length > 0) {
      recommendations.push(
        `⚠ COLLSCAN detected - create index on: ${filterFields.join(', ')}`
      );

      // Suggest compound index if there's a sort
      if (sort) {
        const sortFields = Object.keys(sort);
        const suggestedIndex = [...filterFields, ...sortFields].join(', ');
        recommendations.push(
          `Consider compound index: {${suggestedIndex}} for optimal performance`
        );
      }
    } else {
      recommendations.push('⚠ Full collection scan - consider adding filter criteria or index');
    }
  }

  // Check selectivity ratio
  if (nReturned === 0 && totalDocsExamined > 0) {
    recommendations.push(
      `⚠ Query examined ${totalDocsExamined} documents but returned none - verify filter logic or check if data exists`
    );
  } else if (nReturned > 0 && totalDocsExamined > 0) {
    const selectivityRatio = totalDocsExamined / nReturned;
    if (selectivityRatio > 10) {
      recommendations.push(
        `⚠ Poor selectivity ratio (${selectivityRatio.toFixed(1)}:1) - index not selective enough or missing`
      );
    } else if (selectivityRatio > 3 && selectivityRatio <= 10) {
      recommendations.push(
        `Index selectivity could be improved (examining ${selectivityRatio.toFixed(1)}x more docs than returned)`
      );
    } else if (selectivityRatio <= 1.2) {
      recommendations.push('✓ Excellent index selectivity');
    }
  }

  // Check execution time
  if (executionTimeMs > 1000) {
    recommendations.push(`⚠ Slow query (${executionTimeMs}ms) - optimization needed`);
  } else if (executionTimeMs > 100) {
    recommendations.push(`Query took ${executionTimeMs}ms - consider optimization if frequently executed`);
  } else if (executionTimeMs < 10) {
    recommendations.push(`✓ Fast query execution (${executionTimeMs}ms)`);
  }

  // Check if index is covering query
  if (totalDocsExamined === 0 && totalKeysExamined > 0 && nReturned > 0) {
    recommendations.push('✓ Covered query - all data served from index');
  }

  // Check for index usage on sort
  if (sort && !isCollectionScan) {
    const sortInMemory = stats.executionStages?.inputStage?.stage === 'SORT' ||
                         stats.executionStages?.stage === 'SORT';
    if (sortInMemory) {
      recommendations.push(
        `⚠ In-memory sort detected - consider index on: ${Object.keys(sort).join(', ')}`
      );
    }
  }

  // General recommendations
  if (recommendations.length === 0) {
    recommendations.push('✓ Query performance looks good');
  }

  return recommendations;
}
