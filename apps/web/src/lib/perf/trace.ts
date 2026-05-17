import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

type PerfFields = Record<
  string,
  string | number | boolean | null | undefined
>;

type PerfTraceInput = {
  route: string;
  requestId?: string | null;
  workspaceId?: string | null;
  appId?: string | null;
  runId?: string | null;
};

export type PerfTrace = {
  requestId: string;
  log: (event: string, fields?: PerfFields) => void;
  elapsedMs: () => number;
  time: <T>(
    event: string,
    fn: () => Promise<T>,
    fields?: PerfFields,
  ) => Promise<T>;
};

function perfTraceEnabled(): boolean {
  return process.env.SECOND_PERF_TRACE === "1";
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanFields(fields: PerfFields): PerfFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

function resourceFields(input: {
  startedAt: number;
  startedCpu: NodeJS.CpuUsage;
}): PerfFields {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage(input.startedCpu);

  return {
    sinceStartMs: roundMs(performance.now() - input.startedAt),
    rssMb: roundMetric(memory.rss / 1024 / 1024),
    heapUsedMb: roundMetric(memory.heapUsed / 1024 / 1024),
    heapTotalMb: roundMetric(memory.heapTotal / 1024 / 1024),
    externalMb: roundMetric(memory.external / 1024 / 1024),
    cpuUserMs: roundMetric(cpu.user / 1000),
    cpuSystemMs: roundMetric(cpu.system / 1000),
    uptimeSec: roundMetric(process.uptime()),
  };
}

export function createPerfTrace(input: PerfTraceInput): PerfTrace {
  const requestId = input.requestId?.trim() || randomUUID();
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const base = cleanFields({
    route: input.route,
    requestId,
    workspaceId: input.workspaceId,
    appId: input.appId,
    runId: input.runId,
  });

  const log = (event: string, fields: PerfFields = {}) => {
    if (!perfTraceEnabled()) return;
    console.info(
      JSON.stringify({
        type: "second.perf",
        event,
        at: new Date().toISOString(),
        ...base,
        ...resourceFields({ startedAt, startedCpu }),
        ...cleanFields(fields),
      }),
    );
  };

  return {
    requestId,
    log,
    elapsedMs: () => roundMs(performance.now() - startedAt),
    async time(event, fn, fields = {}) {
      const start = performance.now();
      try {
        const result = await fn();
        log(event, {
          ...fields,
          ok: true,
          elapsedMs: roundMs(performance.now() - start),
        });
        return result;
      } catch (error) {
        log(event, {
          ...fields,
          ok: false,
          elapsedMs: roundMs(performance.now() - start),
          error:
            error instanceof Error ? error.name || "Error" : "UnknownError",
        });
        throw error;
      }
    },
  };
}

export function perfResponseHeaders(trace: PerfTrace): HeadersInit {
  return {
    "x-second-request-id": trace.requestId,
  };
}
