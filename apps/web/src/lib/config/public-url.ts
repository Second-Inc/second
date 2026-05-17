const DEFAULT_PUBLIC_URL = "http://localhost:3000";

type ReadPublicUrlOptions = Readonly<{
  required?: boolean;
}>;

function throwPublicUrlError(message: string): never {
  throw new Error(`[runtime-config] ${message}`);
}

function parsePublicUrl(rawValue: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throwPublicUrlError(
      `SECOND_PUBLIC_URL must be a valid absolute URL. Received "${rawValue}".`,
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throwPublicUrlError(
      `SECOND_PUBLIC_URL must use "http" or "https". Received "${rawValue}".`,
    );
  }

  if (
    parsedUrl.pathname !== "/" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== ""
  ) {
    throwPublicUrlError(
      `SECOND_PUBLIC_URL must include origin only (no path, query, or hash). Received "${rawValue}".`,
    );
  }

  return parsedUrl.origin;
}

export function readPublicUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ReadPublicUrlOptions = {},
): string {
  const rawValue = env.SECOND_PUBLIC_URL?.trim();

  if (!rawValue) {
    if (options.required) {
      throwPublicUrlError("SECOND_PUBLIC_URL is required.");
    }

    return DEFAULT_PUBLIC_URL;
  }

  return parsePublicUrl(rawValue);
}

export const PUBLIC_URL = readPublicUrlFromEnv();
