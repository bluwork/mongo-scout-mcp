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
