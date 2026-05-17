const DEFAULT_WORKER_URL = "http://localhost:3001";

type WorkerFetchInit = RequestInit & {
  workerUrl?: string;
};

export function getWorkerUrl(): string {
  return process.env.WORKER_URL ?? DEFAULT_WORKER_URL;
}

export function workerFetch(
  path: string,
  init?: WorkerFetchInit,
): Promise<Response> {
  const { workerUrl: customWorkerUrl, ...requestInit } = init ?? {};
  const headers = new Headers(requestInit.headers);
  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();

  if (internalToken) {
    headers.set("Authorization", `Bearer ${internalToken}`);
  }

  const workerUrl = customWorkerUrl ?? getWorkerUrl();

  return fetch(`${workerUrl}${path}`, {
    ...requestInit,
    headers,
  });
}
