import dns from "node:dns/promises";
import { isIP } from "node:net";

export function isLoopbackHostname(hostname: string): boolean {
  return /^(localhost|127\.0\.0\.1|::1)$/i.test(hostname);
}

export function isPrivateIP(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (
    normalized.startsWith("10.") ||
    normalized.startsWith("127.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.") ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }

  if (normalized.startsWith("172.")) {
    const secondOctet = Number.parseInt(normalized.split(".")[1] ?? "", 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:169.254.")
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:172.")) {
    const secondOctet = Number.parseInt(
      normalized.split(".")[1]?.split(":").pop() ?? "",
      10,
    );
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return false;
}

export async function resolveHostnameIps(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];

  const [ipv4, ipv6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);
  return [...ipv4, ...ipv6];
}

export async function assertPublicHttpsUrl(input: {
  url: string;
  allowLocalhostInDevelopment?: boolean;
}): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("invalid_url");
  }

  const allowLocalhost =
    input.allowLocalhostInDevelopment &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== "https:" && !allowLocalhost) {
    throw new Error("https_required");
  }

  if (!allowLocalhost) {
    const ips = await resolveHostnameIps(parsed.hostname);
    for (const ip of ips) {
      if (isPrivateIP(ip)) throw new Error("private_ip_blocked");
    }
  }

  return parsed;
}
