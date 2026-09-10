import {
  createHistogram,
  monitorEventLoopDelay,
  performance,
  type Histogram,
  type RecordableHistogram,
} from 'node:perf_hooks';

const EVENT_LOOP_RESOLUTION_MS = 10;

export type DatabaseOperationKind = 'execute' | 'queryOne' | 'queryAll' | 'transaction';
export type CpuTaskKind =
  | 'backup.encode.total'
  | 'backup.decode.total'
  | 'backup.pbkdf2'
  | 'backup.json.stringify.snapshot'
  | 'backup.json.stringify.envelope'
  | 'backup.json.parse.envelope'
  | 'backup.json.parse.snapshot'
  | 'backup.encrypt.payload'
  | 'backup.decrypt.payload'
  | 'websocket.json.parse'
  | 'websocket.json.stringify';

export interface HistogramSummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface RuntimePerformanceInterval {
  eventLoop: {
    utilization: number;
    delay: HistogramSummary;
  };
  database: {
    queueDepth: number;
    maxQueueDepth: number;
    operations: Record<DatabaseOperationKind, number>;
    prepareOperations: number;
    prepare: HistogramSummary;
    queueWait: HistogramSummary;
    execution: HistogramSummary;
    executionByKind: Record<DatabaseOperationKind, HistogramSummary>;
  };
  http: {
    requests: number;
    completedRequests: number;
    activeRequests: number;
    maxActiveRequests: number;
    persistentEligibleRequests: number;
    connectionCloseRequests: number;
    upgradeHeaderRequests: number;
    requestBodyBytes: number;
    responseContentLengthBytes: number;
    status2xx: number;
    status3xx: number;
    status4xx: number;
    status5xx: number;
    duration: HistogramSummary;
  };
  websocket: {
    upgradeAttempts: number;
    upgradeAccepted: number;
    upgradeRejected: number;
    inboundMessages: number;
    inboundBytes: number;
    applicationOutboundMessages: number;
    applicationOutboundBytes: number;
    uploadChunks: number;
    uploadBytes: number;
    maxUploadQueuedBytes: number;
    activeUploadBackpressured: number;
    uploadBackpressureTransitions: number;
  };
  ssh: {
    connectAttempts: number;
    connectSuccesses: number;
    connectFailures: number;
    disconnects: number;
    connectLatency: HistogramSummary;
  };
  terminal: {
    inputEnqueuedItems: number;
    inputEnqueuedBytes: number;
    maxInputQueuedBytes: number;
    inputDrainPauses: number;
    utf8DecodeOperations: number;
    utf8DecodeBytes: number;
    utf8EncodeOperations: number;
    utf8EncodeBytes: number;
    markerFilter: HistogramSummary;
    enqueuedChunks: number;
    enqueuedBytes: number;
    sentChunks: number;
    sentBytes: number;
    flushes: number;
    backpressurePolls: number;
    maxQueuedBytes: number;
    maxBufferedAmountBytes: number;
    activeBackpressured: number;
    backpressureTransitions: number;
    backpressureDurationMs: number;
  };
  sftp: {
    channelOpenAttempts: number;
    channelOpenFailures: number;
    channelOpenLatency: HistogramSummary;
    positionedReadOperations: number;
    positionedReadBytes: number;
    activePositionedReads: number;
    maxActivePositionedReads: number;
    positionedReadAllocations: number;
    positionedReadAllocatedBytes: number;
    maxPositionedReadRequestBytes: number;
    positionedWriteOperations: number;
    positionedWriteBytes: number;
    activePositionedWrites: number;
    maxActivePositionedWrites: number;
    maxPositionedWriteBytes: number;
    readLatency: HistogramSummary;
    writeLatency: HistogramSummary;
  };
  archive: {
    zipStarted: number;
    zipCompleted: number;
    zipCancelled: number;
    activeZip: number;
    maxActiveZip: number;
    outputBytes: number;
    duration: HistogramSummary;
  };
  transfer: {
    filesStarted: number;
    filesCompleted: number;
    blocksStarted: number;
    blocksCompleted: number;
    bytesCopied: number;
    activeBlocks: number;
    maxActiveBlocks: number;
    fileDuration: HistogramSummary;
  };
  cpu: {
    tasks: Partial<Record<CpuTaskKind, HistogramSummary>>;
  };
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
}

const DATABASE_KINDS: readonly DatabaseOperationKind[] = ['execute', 'queryOne', 'queryAll', 'transaction'];
const nsToMs = (value: number): number => Number((value / 1_000_000).toFixed(3));

const summarize = (histogram: Histogram): HistogramSummary => {
  const count = histogram.count;
  if (count === 0) return { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  return {
    count,
    p50Ms: nsToMs(histogram.percentile(50)),
    p95Ms: nsToMs(histogram.percentile(95)),
    p99Ms: nsToMs(histogram.percentile(99)),
    maxMs: nsToMs(histogram.max),
  };
};

const zeroDatabaseCounts = (): Record<DatabaseOperationKind, number> => ({
  execute: 0,
  queryOne: 0,
  queryAll: 0,
  transaction: 0,
});

/**
 * Process-local counters for debug performance diagnosis. Collection is disabled unless debug/trace
 * logging enables the reporter (or a benchmark explicitly starts it), keeping the normal info path cheap.
 */
export class RuntimePerformanceMetrics {
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  private readonly dbQueueWait: RecordableHistogram = createHistogram();
  private readonly dbPrepare: RecordableHistogram = createHistogram();
  private readonly dbExecution: RecordableHistogram = createHistogram();
  private readonly dbExecutionByKind = new Map<DatabaseOperationKind, RecordableHistogram>(
    DATABASE_KINDS.map((kind) => [kind, createHistogram()]),
  );
  private readonly httpDuration: RecordableHistogram = createHistogram();
  private readonly sshConnectLatency: RecordableHistogram = createHistogram();
  private readonly sftpChannelOpenLatency: RecordableHistogram = createHistogram();
  private readonly sftpReadLatency: RecordableHistogram = createHistogram();
  private readonly sftpWriteLatency: RecordableHistogram = createHistogram();
  private readonly transferFileDuration: RecordableHistogram = createHistogram();
  private readonly archiveZipDuration: RecordableHistogram = createHistogram();
  private readonly terminalMarkerFilter: RecordableHistogram = createHistogram();
  private readonly cpuTaskHistograms = new Map<CpuTaskKind, RecordableHistogram>();

  private previousElu = performance.eventLoopUtilization();
  private started = false;
  private collectionStartedAt = 0n;

  private dbQueueDepth = 0;
  private maxDbQueueDepth = 0;
  private dbOperations = zeroDatabaseCounts();
  private dbPrepareOperations = 0;

  private httpRequests = 0;
  private httpCompletedRequests = 0;
  private activeHttpRequests = 0;
  private maxActiveHttpRequests = 0;
  private persistentEligibleRequests = 0;
  private connectionCloseRequests = 0;
  private httpUpgradeHeaderRequests = 0;
  private httpRequestBodyBytes = 0;
  private httpResponseContentLengthBytes = 0;
  private httpStatus2xx = 0;
  private httpStatus3xx = 0;
  private httpStatus4xx = 0;
  private httpStatus5xx = 0;

  private wsUpgradeAttempts = 0;
  private wsUpgradeAccepted = 0;
  private wsUpgradeRejected = 0;
  private wsInboundMessages = 0;
  private wsInboundBytes = 0;
  private wsOutboundMessages = 0;
  private wsOutboundBytes = 0;
  private uploadChunks = 0;
  private uploadBytes = 0;
  private maxUploadQueuedBytes = 0;
  private activeUploadBackpressured = 0;
  private uploadBackpressureTransitions = 0;

  private sshConnectAttempts = 0;
  private sshConnectSuccesses = 0;
  private sshConnectFailures = 0;
  private sshDisconnects = 0;

  private terminalInputEnqueuedItems = 0;
  private terminalInputEnqueuedBytes = 0;
  private maxTerminalInputQueuedBytes = 0;
  private terminalInputDrainPauses = 0;
  private terminalUtf8DecodeOperations = 0;
  private terminalUtf8DecodeBytes = 0;
  private terminalUtf8EncodeOperations = 0;
  private terminalUtf8EncodeBytes = 0;
  private terminalEnqueuedChunks = 0;
  private terminalEnqueuedBytes = 0;
  private terminalSentChunks = 0;
  private terminalSentBytes = 0;
  private terminalFlushes = 0;
  private terminalBackpressurePolls = 0;
  private maxTerminalQueuedBytes = 0;
  private maxTerminalBufferedAmountBytes = 0;
  private activeTerminalBackpressured = 0;
  private terminalBackpressureTransitions = 0;
  private terminalBackpressureDurationNs = 0n;

  private sftpChannelOpenAttempts = 0;
  private sftpChannelOpenFailures = 0;
  private positionedReadOperations = 0;
  private positionedReadBytes = 0;
  private activePositionedReads = 0;
  private maxActivePositionedReads = 0;
  private positionedReadAllocations = 0;
  private positionedReadAllocatedBytes = 0;
  private maxPositionedReadRequestBytes = 0;
  private positionedWriteOperations = 0;
  private positionedWriteBytes = 0;
  private activePositionedWrites = 0;
  private maxActivePositionedWrites = 0;
  private maxPositionedWriteBytes = 0;

  private archiveZipStartedCount = 0;
  private archiveZipCompleted = 0;
  private archiveZipCancelled = 0;
  private activeArchiveZip = 0;
  private maxActiveArchiveZip = 0;
  private archiveZipOutputBytes = 0;

  private transferFilesStarted = 0;
  private transferFilesCompleted = 0;
  private transferBlocksStarted = 0;
  private transferBlocksCompleted = 0;
  private transferBytesCopied = 0;
  private activeTransferBlocks = 0;
  private maxActiveTransferBlocks = 0;

  get enabled(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    // Operations that began while collection was disabled cannot be reconstructed
    // reliably, so start each collection window from clean live gauges and a new
    // monotonic boundary. Finishes from an older debug window are ignored.
    this.resetLiveGauges();
    this.collectionStartedAt = process.hrtime.bigint();
    this.started = true;
    this.eventLoopDelay.enable();
    this.resetInterval();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.collectionStartedAt = 0n;
    this.eventLoopDelay.disable();
    // Finishes that happen while collection is disabled are intentionally ignored.
    // Clear their corresponding gauges now so a later debug session cannot inherit
    // stale "active" counts from the previous collection window.
    this.resetLiveGauges();
    this.resetInterval();
  }

  operationStarted(): bigint {
    return this.started ? process.hrtime.bigint() : 0n;
  }

  databaseEnqueued(): bigint {
    if (!this.started) return 0n;
    this.dbQueueDepth += 1;
    this.maxDbQueueDepth = Math.max(this.maxDbQueueDepth, this.dbQueueDepth);
    return process.hrtime.bigint();
  }

  databaseStarted(enqueuedAt: bigint, queueWait?: bigint): void {
    if (!this.belongsToCurrentCollection(enqueuedAt)) return;
    this.dbQueueDepth = Math.max(0, this.dbQueueDepth - 1);
    this.recordHistogram(this.dbQueueWait, queueWait ?? process.hrtime.bigint() - enqueuedAt);
  }

  recordDatabaseExecution(kind: DatabaseOperationKind, duration: bigint, startedAt?: bigint): void {
    if (!this.started || (startedAt !== undefined && !this.belongsToCurrentCollection(startedAt))) return;
    this.dbOperations[kind] += 1;
    this.recordHistogram(this.dbExecution, duration);
    this.recordHistogram(this.dbExecutionByKind.get(kind)!, duration);
  }

  recordDatabasePrepare(duration: bigint, startedAt?: bigint): void {
    if (!this.started || (startedAt !== undefined && !this.belongsToCurrentCollection(startedAt))) return;
    this.dbPrepareOperations += 1;
    this.recordHistogram(this.dbPrepare, duration);
  }

  httpRequestStarted(options: {
    persistentEligible: boolean;
    connectionClose: boolean;
    upgradeHeader: boolean;
    requestBodyBytes: number;
  }): bigint {
    if (!this.started) return 0n;
    this.httpRequests += 1;
    this.activeHttpRequests += 1;
    this.maxActiveHttpRequests = Math.max(this.maxActiveHttpRequests, this.activeHttpRequests);
    if (options.persistentEligible) this.persistentEligibleRequests += 1;
    if (options.connectionClose) this.connectionCloseRequests += 1;
    if (options.upgradeHeader) this.httpUpgradeHeaderRequests += 1;
    this.httpRequestBodyBytes += Math.max(0, options.requestBodyBytes);
    return process.hrtime.bigint();
  }

  httpRequestFinished(startedAt: bigint, statusCode: number, responseContentLengthBytes = 0): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    this.activeHttpRequests = Math.max(0, this.activeHttpRequests - 1);
    this.httpCompletedRequests += 1;
    this.httpResponseContentLengthBytes += Math.max(0, responseContentLengthBytes);
    if (statusCode >= 500) this.httpStatus5xx += 1;
    else if (statusCode >= 400) this.httpStatus4xx += 1;
    else if (statusCode >= 300) this.httpStatus3xx += 1;
    else if (statusCode >= 200) this.httpStatus2xx += 1;
    this.recordHistogram(this.httpDuration, process.hrtime.bigint() - startedAt);
  }

  webSocketUpgradeAttempt(): void {
    if (this.started) this.wsUpgradeAttempts += 1;
  }

  webSocketUpgradeAccepted(): void {
    if (this.started) this.wsUpgradeAccepted += 1;
  }

  webSocketUpgradeRejected(): void {
    if (this.started) this.wsUpgradeRejected += 1;
  }

  recordWebSocketInbound(bytes: number): void {
    if (!this.started) return;
    this.wsInboundMessages += 1;
    this.wsInboundBytes += Math.max(0, bytes);
  }

  recordWebSocketOutbound(bytes: number): void {
    if (!this.started) return;
    this.wsOutboundMessages += 1;
    this.wsOutboundBytes += Math.max(0, bytes);
  }

  recordUploadChunk(bytes: number, queuedBytes: number): void {
    if (!this.started) return;
    this.uploadChunks += 1;
    this.uploadBytes += Math.max(0, bytes);
    this.maxUploadQueuedBytes = Math.max(this.maxUploadQueuedBytes, Math.max(0, queuedBytes));
  }

  uploadBackpressureChanged(active: boolean): void {
    if (!this.started) return;
    this.activeUploadBackpressured = Math.max(0, this.activeUploadBackpressured + (active ? 1 : -1));
    this.uploadBackpressureTransitions += 1;
  }

  recordSshConnect(startedAt: bigint, success: boolean): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    this.sshConnectAttempts += 1;
    if (success) this.sshConnectSuccesses += 1;
    else this.sshConnectFailures += 1;
    this.recordHistogram(this.sshConnectLatency, process.hrtime.bigint() - startedAt);
  }

  recordSshDisconnect(): void {
    if (this.started) this.sshDisconnects += 1;
  }

  recordTerminalInputQueued(bytes: number, queuedBytes: number): void {
    if (!this.started) return;
    this.terminalInputEnqueuedItems += 1;
    this.terminalInputEnqueuedBytes += Math.max(0, bytes);
    this.maxTerminalInputQueuedBytes = Math.max(this.maxTerminalInputQueuedBytes, Math.max(0, queuedBytes));
  }

  recordTerminalInputDrainPause(): void {
    if (this.started) this.terminalInputDrainPauses += 1;
  }

  recordTerminalUtf8Decode(bytes: number): void {
    if (!this.started) return;
    this.terminalUtf8DecodeOperations += 1;
    this.terminalUtf8DecodeBytes += Math.max(0, bytes);
  }

  recordTerminalUtf8Encode(bytes: number): void {
    if (!this.started) return;
    this.terminalUtf8EncodeOperations += 1;
    this.terminalUtf8EncodeBytes += Math.max(0, bytes);
  }

  recordTerminalMarkerFilter(duration: bigint): void {
    if (this.started) this.recordHistogram(this.terminalMarkerFilter, duration);
  }

  recordTerminalEnqueue(bytes: number, queuedBytes: number, bufferedAmountBytes: number): void {
    if (!this.started) return;
    this.terminalEnqueuedChunks += 1;
    this.terminalEnqueuedBytes += Math.max(0, bytes);
    this.recordTerminalBuffers(queuedBytes, bufferedAmountBytes);
  }

  recordTerminalSent(bytes: number, queuedBytes: number, bufferedAmountBytes: number): void {
    if (!this.started) return;
    this.terminalSentChunks += 1;
    this.terminalSentBytes += Math.max(0, bytes);
    this.recordTerminalBuffers(queuedBytes, bufferedAmountBytes);
  }

  recordTerminalFlush(): void {
    if (this.started) this.terminalFlushes += 1;
  }

  recordTerminalBackpressurePoll(): void {
    if (this.started) this.terminalBackpressurePolls += 1;
  }

  recordTerminalBuffers(queuedBytes: number, bufferedAmountBytes: number): void {
    if (!this.started) return;
    this.maxTerminalQueuedBytes = Math.max(this.maxTerminalQueuedBytes, Math.max(0, queuedBytes));
    this.maxTerminalBufferedAmountBytes = Math.max(
      this.maxTerminalBufferedAmountBytes,
      Math.max(0, bufferedAmountBytes),
    );
  }

  terminalBackpressureChanged(active: boolean): void {
    if (!this.started) return;
    this.activeTerminalBackpressured = Math.max(0, this.activeTerminalBackpressured + (active ? 1 : -1));
    this.terminalBackpressureTransitions += 1;
  }

  recordTerminalBackpressureDuration(startedAt: bigint): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    const duration = process.hrtime.bigint() - startedAt;
    if (duration > 0n) this.terminalBackpressureDurationNs += duration;
  }

  sftpChannelOpenStarted(): bigint {
    if (!this.started) return 0n;
    this.sftpChannelOpenAttempts += 1;
    return process.hrtime.bigint();
  }

  sftpChannelOpenFinished(startedAt: bigint, success: boolean): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    if (!success) this.sftpChannelOpenFailures += 1;
    this.recordHistogram(this.sftpChannelOpenLatency, process.hrtime.bigint() - startedAt);
  }

  sftpPositionedReadStarted(requestedBytes: number): bigint {
    if (!this.started) return 0n;
    this.positionedReadOperations += 1;
    this.maxPositionedReadRequestBytes = Math.max(this.maxPositionedReadRequestBytes, Math.max(0, requestedBytes));
    this.activePositionedReads += 1;
    this.maxActivePositionedReads = Math.max(this.maxActivePositionedReads, this.activePositionedReads);
    return process.hrtime.bigint();
  }

  recordSftpPositionedReadAllocation(bytes: number): void {
    if (!this.started || bytes <= 0) return;
    this.positionedReadAllocations += 1;
    this.positionedReadAllocatedBytes += bytes;
  }

  sftpPositionedReadFinished(startedAt: bigint, actualBytes: number): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    this.activePositionedReads = Math.max(0, this.activePositionedReads - 1);
    this.positionedReadBytes += Math.max(0, actualBytes);
    this.recordHistogram(this.sftpReadLatency, process.hrtime.bigint() - startedAt);
  }

  sftpPositionedWriteStarted(bytes: number): bigint {
    if (!this.started) return 0n;
    this.positionedWriteOperations += 1;
    this.positionedWriteBytes += Math.max(0, bytes);
    this.maxPositionedWriteBytes = Math.max(this.maxPositionedWriteBytes, Math.max(0, bytes));
    this.activePositionedWrites += 1;
    this.maxActivePositionedWrites = Math.max(this.maxActivePositionedWrites, this.activePositionedWrites);
    return process.hrtime.bigint();
  }

  sftpPositionedWriteFinished(startedAt: bigint): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    this.activePositionedWrites = Math.max(0, this.activePositionedWrites - 1);
    this.recordHistogram(this.sftpWriteLatency, process.hrtime.bigint() - startedAt);
  }

  archiveZipStarted(): bigint {
    if (!this.started) return 0n;
    this.archiveZipStartedCount += 1;
    this.activeArchiveZip += 1;
    this.maxActiveArchiveZip = Math.max(this.maxActiveArchiveZip, this.activeArchiveZip);
    return process.hrtime.bigint();
  }

  archiveZipFinished(startedAt: bigint, completed: boolean, cancelled: boolean, outputBytes: number): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    this.activeArchiveZip = Math.max(0, this.activeArchiveZip - 1);
    if (completed) this.archiveZipCompleted += 1;
    if (cancelled) this.archiveZipCancelled += 1;
    this.archiveZipOutputBytes += Math.max(0, outputBytes);
    this.recordHistogram(this.archiveZipDuration, process.hrtime.bigint() - startedAt);
  }

  transferFileStarted(): bigint {
    if (!this.started) return 0n;
    this.transferFilesStarted += 1;
    return process.hrtime.bigint();
  }

  transferFileFinished(startedAt: bigint, completed: boolean): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    if (completed) this.transferFilesCompleted += 1;
    this.recordHistogram(this.transferFileDuration, process.hrtime.bigint() - startedAt);
  }

  transferBlockStarted(): bigint {
    if (!this.started) return 0n;
    this.transferBlocksStarted += 1;
    this.activeTransferBlocks += 1;
    this.maxActiveTransferBlocks = Math.max(this.maxActiveTransferBlocks, this.activeTransferBlocks);
    return process.hrtime.bigint();
  }

  transferBlockFinished(startedAt: bigint, bytes: number): void {
    if (!this.belongsToCurrentCollection(startedAt)) return;
    this.transferBlocksCompleted += 1;
    this.activeTransferBlocks = Math.max(0, this.activeTransferBlocks - 1);
    this.transferBytesCopied += Math.max(0, bytes);
  }

  recordCpuTask(kind: CpuTaskKind, duration: bigint, startedAt?: bigint): void {
    if (!this.started || (startedAt !== undefined && !this.belongsToCurrentCollection(startedAt))) return;
    let histogram = this.cpuTaskHistograms.get(kind);
    if (!histogram) {
      histogram = createHistogram();
      this.cpuTaskHistograms.set(kind, histogram);
    }
    this.recordHistogram(histogram, duration);
  }

  snapshotAndReset(): RuntimePerformanceInterval {
    const memory = process.memoryUsage();
    const elu = performance.eventLoopUtilization(this.previousElu);
    this.previousElu = performance.eventLoopUtilization();
    const cpuTasks: Partial<Record<CpuTaskKind, HistogramSummary>> = {};
    for (const [kind, histogram] of this.cpuTaskHistograms) cpuTasks[kind] = summarize(histogram);

    const snapshot: RuntimePerformanceInterval = {
      eventLoop: {
        utilization: Number(elu.utilization.toFixed(4)),
        delay: summarize(this.eventLoopDelay),
      },
      database: {
        queueDepth: this.dbQueueDepth,
        maxQueueDepth: this.maxDbQueueDepth,
        operations: { ...this.dbOperations },
        prepareOperations: this.dbPrepareOperations,
        prepare: summarize(this.dbPrepare),
        queueWait: summarize(this.dbQueueWait),
        execution: summarize(this.dbExecution),
        executionByKind: Object.fromEntries(
          DATABASE_KINDS.map((kind) => [kind, summarize(this.dbExecutionByKind.get(kind)!)]),
        ) as Record<DatabaseOperationKind, HistogramSummary>,
      },
      http: {
        requests: this.httpRequests,
        completedRequests: this.httpCompletedRequests,
        activeRequests: this.activeHttpRequests,
        maxActiveRequests: this.maxActiveHttpRequests,
        persistentEligibleRequests: this.persistentEligibleRequests,
        connectionCloseRequests: this.connectionCloseRequests,
        upgradeHeaderRequests: this.httpUpgradeHeaderRequests,
        requestBodyBytes: this.httpRequestBodyBytes,
        responseContentLengthBytes: this.httpResponseContentLengthBytes,
        status2xx: this.httpStatus2xx,
        status3xx: this.httpStatus3xx,
        status4xx: this.httpStatus4xx,
        status5xx: this.httpStatus5xx,
        duration: summarize(this.httpDuration),
      },
      websocket: {
        upgradeAttempts: this.wsUpgradeAttempts,
        upgradeAccepted: this.wsUpgradeAccepted,
        upgradeRejected: this.wsUpgradeRejected,
        inboundMessages: this.wsInboundMessages,
        inboundBytes: this.wsInboundBytes,
        applicationOutboundMessages: this.wsOutboundMessages,
        applicationOutboundBytes: this.wsOutboundBytes,
        uploadChunks: this.uploadChunks,
        uploadBytes: this.uploadBytes,
        maxUploadQueuedBytes: this.maxUploadQueuedBytes,
        activeUploadBackpressured: this.activeUploadBackpressured,
        uploadBackpressureTransitions: this.uploadBackpressureTransitions,
      },
      ssh: {
        connectAttempts: this.sshConnectAttempts,
        connectSuccesses: this.sshConnectSuccesses,
        connectFailures: this.sshConnectFailures,
        disconnects: this.sshDisconnects,
        connectLatency: summarize(this.sshConnectLatency),
      },
      terminal: {
        inputEnqueuedItems: this.terminalInputEnqueuedItems,
        inputEnqueuedBytes: this.terminalInputEnqueuedBytes,
        maxInputQueuedBytes: this.maxTerminalInputQueuedBytes,
        inputDrainPauses: this.terminalInputDrainPauses,
        utf8DecodeOperations: this.terminalUtf8DecodeOperations,
        utf8DecodeBytes: this.terminalUtf8DecodeBytes,
        utf8EncodeOperations: this.terminalUtf8EncodeOperations,
        utf8EncodeBytes: this.terminalUtf8EncodeBytes,
        markerFilter: summarize(this.terminalMarkerFilter),
        enqueuedChunks: this.terminalEnqueuedChunks,
        enqueuedBytes: this.terminalEnqueuedBytes,
        sentChunks: this.terminalSentChunks,
        sentBytes: this.terminalSentBytes,
        flushes: this.terminalFlushes,
        backpressurePolls: this.terminalBackpressurePolls,
        maxQueuedBytes: this.maxTerminalQueuedBytes,
        maxBufferedAmountBytes: this.maxTerminalBufferedAmountBytes,
        activeBackpressured: this.activeTerminalBackpressured,
        backpressureTransitions: this.terminalBackpressureTransitions,
        backpressureDurationMs: Number(this.terminalBackpressureDurationNs) / 1_000_000,
      },
      sftp: {
        channelOpenAttempts: this.sftpChannelOpenAttempts,
        channelOpenFailures: this.sftpChannelOpenFailures,
        channelOpenLatency: summarize(this.sftpChannelOpenLatency),
        positionedReadOperations: this.positionedReadOperations,
        positionedReadBytes: this.positionedReadBytes,
        activePositionedReads: this.activePositionedReads,
        maxActivePositionedReads: this.maxActivePositionedReads,
        positionedReadAllocations: this.positionedReadAllocations,
        positionedReadAllocatedBytes: this.positionedReadAllocatedBytes,
        maxPositionedReadRequestBytes: this.maxPositionedReadRequestBytes,
        positionedWriteOperations: this.positionedWriteOperations,
        positionedWriteBytes: this.positionedWriteBytes,
        activePositionedWrites: this.activePositionedWrites,
        maxActivePositionedWrites: this.maxActivePositionedWrites,
        maxPositionedWriteBytes: this.maxPositionedWriteBytes,
        readLatency: summarize(this.sftpReadLatency),
        writeLatency: summarize(this.sftpWriteLatency),
      },
      archive: {
        zipStarted: this.archiveZipStartedCount,
        zipCompleted: this.archiveZipCompleted,
        zipCancelled: this.archiveZipCancelled,
        activeZip: this.activeArchiveZip,
        maxActiveZip: this.maxActiveArchiveZip,
        outputBytes: this.archiveZipOutputBytes,
        duration: summarize(this.archiveZipDuration),
      },
      transfer: {
        filesStarted: this.transferFilesStarted,
        filesCompleted: this.transferFilesCompleted,
        blocksStarted: this.transferBlocksStarted,
        blocksCompleted: this.transferBlocksCompleted,
        bytesCopied: this.transferBytesCopied,
        activeBlocks: this.activeTransferBlocks,
        maxActiveBlocks: this.maxActiveTransferBlocks,
        fileDuration: summarize(this.transferFileDuration),
      },
      cpu: { tasks: cpuTasks },
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
    };
    this.resetInterval();
    return snapshot;
  }

  resetInterval(): void {
    this.eventLoopDelay.reset();
    this.dbQueueWait.reset();
    this.dbPrepare.reset();
    this.dbExecution.reset();
    for (const histogram of this.dbExecutionByKind.values()) histogram.reset();
    this.httpDuration.reset();
    this.sshConnectLatency.reset();
    this.sftpChannelOpenLatency.reset();
    this.sftpReadLatency.reset();
    this.sftpWriteLatency.reset();
    this.transferFileDuration.reset();
    this.archiveZipDuration.reset();
    this.terminalMarkerFilter.reset();
    for (const histogram of this.cpuTaskHistograms.values()) histogram.reset();

    this.maxDbQueueDepth = this.dbQueueDepth;
    this.dbOperations = zeroDatabaseCounts();
    this.dbPrepareOperations = 0;

    this.httpRequests = 0;
    this.httpCompletedRequests = 0;
    this.maxActiveHttpRequests = this.activeHttpRequests;
    this.persistentEligibleRequests = 0;
    this.connectionCloseRequests = 0;
    this.httpUpgradeHeaderRequests = 0;
    this.httpRequestBodyBytes = 0;
    this.httpResponseContentLengthBytes = 0;
    this.httpStatus2xx = 0;
    this.httpStatus3xx = 0;
    this.httpStatus4xx = 0;
    this.httpStatus5xx = 0;

    this.wsUpgradeAttempts = 0;
    this.wsUpgradeAccepted = 0;
    this.wsUpgradeRejected = 0;
    this.wsInboundMessages = 0;
    this.wsInboundBytes = 0;
    this.wsOutboundMessages = 0;
    this.wsOutboundBytes = 0;
    this.uploadChunks = 0;
    this.uploadBytes = 0;
    this.maxUploadQueuedBytes = 0;
    this.uploadBackpressureTransitions = 0;

    this.sshConnectAttempts = 0;
    this.sshConnectSuccesses = 0;
    this.sshConnectFailures = 0;
    this.sshDisconnects = 0;

    this.terminalInputEnqueuedItems = 0;
    this.terminalInputEnqueuedBytes = 0;
    this.maxTerminalInputQueuedBytes = 0;
    this.terminalInputDrainPauses = 0;
    this.terminalUtf8DecodeOperations = 0;
    this.terminalUtf8DecodeBytes = 0;
    this.terminalUtf8EncodeOperations = 0;
    this.terminalUtf8EncodeBytes = 0;
    this.terminalEnqueuedChunks = 0;
    this.terminalEnqueuedBytes = 0;
    this.terminalSentChunks = 0;
    this.terminalSentBytes = 0;
    this.terminalFlushes = 0;
    this.terminalBackpressurePolls = 0;
    this.maxTerminalQueuedBytes = 0;
    this.maxTerminalBufferedAmountBytes = 0;
    this.terminalBackpressureTransitions = 0;
    this.terminalBackpressureDurationNs = 0n;

    this.sftpChannelOpenAttempts = 0;
    this.sftpChannelOpenFailures = 0;
    this.positionedReadOperations = 0;
    this.positionedReadBytes = 0;
    this.maxActivePositionedReads = this.activePositionedReads;
    this.positionedReadAllocations = 0;
    this.positionedReadAllocatedBytes = 0;
    this.maxPositionedReadRequestBytes = 0;
    this.positionedWriteOperations = 0;
    this.positionedWriteBytes = 0;
    this.maxActivePositionedWrites = this.activePositionedWrites;
    this.maxPositionedWriteBytes = 0;

    this.archiveZipStartedCount = 0;
    this.archiveZipCompleted = 0;
    this.archiveZipCancelled = 0;
    this.maxActiveArchiveZip = this.activeArchiveZip;
    this.archiveZipOutputBytes = 0;

    this.transferFilesStarted = 0;
    this.transferFilesCompleted = 0;
    this.transferBlocksStarted = 0;
    this.transferBlocksCompleted = 0;
    this.transferBytesCopied = 0;
    this.maxActiveTransferBlocks = this.activeTransferBlocks;

    this.previousElu = performance.eventLoopUtilization();
  }

  private resetLiveGauges(): void {
    this.dbQueueDepth = 0;
    this.activeHttpRequests = 0;
    this.activeUploadBackpressured = 0;
    this.activeTerminalBackpressured = 0;
    this.activePositionedReads = 0;
    this.activePositionedWrites = 0;
    this.activeArchiveZip = 0;
    this.activeTransferBlocks = 0;
  }

  private belongsToCurrentCollection(startedAt: bigint): boolean {
    return this.started && startedAt !== 0n && startedAt >= this.collectionStartedAt;
  }

  private recordHistogram(histogram: RecordableHistogram, duration: bigint): void {
    histogram.record(duration > 0n ? duration : 1n);
  }
}

export const runtimePerformanceMetrics = new RuntimePerformanceMetrics();
