import { Agent, type Dispatcher } from "undici";

const DEFAULT_WORKER_URL = "http://localhost:3001";

type WorkerFetchInit = RequestInit & {
  workerUrl?: string;
  disableBodyTimeout?: boolean;
};

let workerStreamDispatcher: Agent | null = null;

function getWorkerStreamDispatcher(): Agent {
  workerStreamDispatcher ??= new Agent({ bodyTimeout: 0 });
  return workerStreamDispatcher;
}

export function getWorkerUrl(): string {
  return process.env.WORKER_URL ?? DEFAULT_WORKER_URL;
}

export function workerFetch(
  path: string,
  init?: WorkerFetchInit,
): Promise<Response> {
  const {
    workerUrl: customWorkerUrl,
    disableBodyTimeout,
    ...requestInit
  } = init ?? {};
  const headers = new Headers(requestInit.headers);
  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();

  if (internalToken) {
    headers.set("Authorization", `Bearer ${internalToken}`);
  }

  const workerUrl = customWorkerUrl ?? getWorkerUrl();
  const fetchInit: RequestInit & { dispatcher?: Dispatcher } = {
    ...requestInit,
    headers,
  };

  if (disableBodyTimeout) {
    fetchInit.dispatcher = getWorkerStreamDispatcher();
  }

  return fetch(`${workerUrl}${path}`, fetchInit);
}
