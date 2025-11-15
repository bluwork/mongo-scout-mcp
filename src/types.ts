export interface ServerStatus {
  host?: string;
  version: string;
  process: string;
  pid: number;
  uptime: number;
  uptimeMillis: number;
  uptimeEstimate: number;
  localTime: Date;
  connections?: {
    current: number;
    available: number;
    totalCreated: number;
    active: number;
    threaded: number;
  };
  opcounters?: {
    insert: number;
    query: number;
    update: number;
    delete: number;
    getmore: number;
    command: number;
  };
  mem?: {
    bits: number;
    resident: number;
    virtual: number;
    mapped: number;
    mappedWithJournal: number;
  };
  network?: {
    bytesIn: number;
    bytesOut: number;
    physicalBytesIn: number;
    physicalBytesOut: number;
    numSlowDNSOperations: number;
    numSlowSSLOperations: number;
    numRequests: number;
  };
  globalLock?: {
    totalTime: number;
    lockTime: number;
    currentQueue: {
      total: number;
      readers: number;
      writers: number;
    };
    activeClients: {
      total: number;
      readers: number;
      writers: number;
    };
  };
  asserts?: {
    regular: number;
    warning: number;
    msg: number;
    user: number;
    rollovers: number;
  };
}

export interface DatabaseStats {
  db: string;
  collections: number;
  views: number;
  objects: number;
  avgObjSize: number;
  dataSize: number;
  storageSize: number;
  freeStorageSize: number;
  indexes: number;
  indexSize: number;
  totalSize: number;
  scaleFactor: number;
  fileSize: number;
  nsSizeMB: number;
  fsUsedSize: number;
  fsTotalSize: number;
}

export interface ConnectionPoolStats {
  totalInUse: number;
  totalAvailable: number;
  totalCreated: number;
  totalDestroyed: number;
  poolResetCount: number;
  connectionMetrics: {
    current: number;
    available: number;
    totalCreated: number;
    active: number;
    threaded: number;
  };
}

export interface CurrentOperation {
  opid: number;
  active: boolean;
  secs_running: number;
  microsecs_running: number;
  op: string;
  ns: string;
  command?: Record<string, unknown>;
  originatingCommand?: Record<string, unknown>;
  client: string;
  appName?: string;
  clientMetadata?: Record<string, unknown>;
  desc: string;
  threadId: string;
  connectionId: number;
}

export interface ProfilerEntry {
  op: string;
  ns: string;
  command?: Record<string, unknown>;
  ts: Date;
  millis: number;
  execStats?: Record<string, unknown>;
  planSummary?: string;
  keyUpdates?: number;
  writeConflicts?: number;
  numYield?: number;
  locks?: Record<string, unknown>;
  user?: string;
  appName?: string;
}

export interface MongoAdminError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  mongoError?: Record<string, unknown>;
}

export interface AppConfig {
  uri: string;
  dbName: string;
  mode: string;
  logDir: string;
}

export interface CurrentOpCommand {
  currentOp: boolean | number;
  $all?: boolean;
  $ownOps?: boolean;
  $local?: boolean;
  $truncateOps?: boolean;
  ns?: string;
  microsecs_running?: { $gte: number };
}

export interface CurrentOpResult {
  inprog: CurrentOperation[];
  ok: number;
}

export interface CollectionStats {
  ns: string;
  size: number;
  count: number;
  avgObjSize: number;
  storageSize: number;
  freeStorageSize?: number;
  nindexes: number;
  totalIndexSize: number;
  indexSizes?: Record<string, number>;
  capped?: boolean;
  max?: number;
  wiredTiger?: Record<string, unknown>;
}

export interface IndexUsageStat {
  name: string;
  accesses?: {
    ops: number;
    since: Date;
  };
}

export interface LiveMetric {
  timestamp: string;
  operations: {
    counters: NonNullable<ServerStatus['opcounters']>;
    ratesPerSecond: {
      insert: number;
      query: number;
      update: number;
      delete: number;
      command: number;
      getmore: number;
    };
  };
  connections: NonNullable<ServerStatus['connections']>;
  network: {
    totals: NonNullable<ServerStatus['network']>;
    ratesPerSecond: {
      bytesInPerSec: number;
      bytesOutPerSec: number;
      requestsPerSec: number;
    };
  };
  memory: NonNullable<ServerStatus['mem']>;
  globalLock: NonNullable<ServerStatus['globalLock']>;
}

export interface ProfilerStatus {
  was: number;
  slowms?: number;
  sampleRate?: number;
  filter?: Record<string, unknown>;
  ok: number;
  enabled?: string;
  message?: string;
}

export interface SlowOperation {
  operation: string;
  namespace: string;
  duration: number;
  timestamp?: Date;
  query?: Record<string, unknown>;
  planSummary?: string;
  docsExamined?: number;
  keysExamined?: number;
  writeConflicts?: number;
  user?: string;
  client?: string;
  appName?: string;
  source?: 'profiler' | 'currentOp';
  active?: boolean;
  opid?: number;
  runningTime?: number;
  waitingForLock?: boolean;
  lockStats?: Record<string, unknown>;
  killable?: boolean;
}

export interface HottestCollection {
  collection: string;
  namespace: string;
  activeOperations: number;
  percentageOfTotal: number;
  size: number;
  count: number;
  avgObjSize: number;
  indexes: number;
  readWriteRatio: string | number;
}

export interface CollectionMetrics {
  collection: string;
  namespace: string;
  storage: {
    documents: number;
    size: number;
    avgDocumentSize: number;
    storageSize: number;
    freeStorageSize: number;
    capped: boolean;
    max: number | null;
  };
  indexes: {
    count: number;
    totalSize: number;
    details: Record<string, number>;
    usage: Array<{
      name: string;
      operations: number;
      since: Date | null;
    }>;
  };
  operations: {
    current: {
      active: number;
      operations: Array<{
        operation: string;
        duration: number;
        opid: number;
      }>;
    };
    recent: {
      count: number;
      breakdown: {
        insert: number;
        query: number;
        update: number;
        delete: number;
      };
    };
    ratesPerSecond: {
      insert: number;
      query: number;
      update: number;
      delete: number;
      total: number;
    } | null;
  };
  wiredTiger: Record<string, unknown> | null;
}

export type MongoDocument = Record<string, unknown>;
export type MongoQuery = Record<string, unknown>;
export type MongoFilter = Record<string, unknown>;
export type MongoUpdate = Record<string, unknown>;
export type MongoProjection = Record<string, number | boolean>;
export type MongoSort = Record<string, 1 | -1>;
export type MongoPipeline = Array<Record<string, unknown>>;

export interface SchemaField {
  type: string;
  required?: boolean;
  unique?: boolean;
  enum?: unknown[];
  examples?: unknown[];
  nested?: Record<string, SchemaField>;
}

export type InferredSchema = Record<string, SchemaField>;

export interface ToolHandler<TArgs = unknown, TResult = unknown> {
  (args: TArgs): Promise<TResult>;
}
