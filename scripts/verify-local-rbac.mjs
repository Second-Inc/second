#!/usr/bin/env node

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, value);
    index += 1;
  }

  return args;
}

function requireArg(args, key) {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;=]+=[^;]+)/g) : [];
}

function cookieHeaderFromSetCookies(setCookies) {
  return setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function signIn(input) {
  const formData = new FormData();
  formData.set("displayName", input.name);
  formData.set("email", input.email);

  const response = await fetch(new URL("/api/onboarding/identity", input.baseUrl), {
    method: "POST",
    body: formData,
    redirect: "manual",
  });

  const cookies = cookieHeaderFromSetCookies(readSetCookies(response.headers));
  if (!cookies) {
    throw new Error("Local sign-in did not return session cookies.");
  }

  return cookies;
}

async function expectForbidden(input) {
  const response = await fetch(new URL(input.path, input.baseUrl), {
    method: input.method,
    headers: {
      Cookie: input.cookies,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const ok = response.status === 403;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${input.method} ${input.path} -> ${response.status}`,
  );

  return ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = requireArg(args, "base-url").replace(/\/$/, "");
  const workspaceId = requireArg(args, "workspace-id").toLowerCase();
  const email = requireArg(args, "email");
  const name = requireArg(args, "name");
  const integrationId =
    args.get("integration-id")?.trim() || "000000000000000000000000";

  if (!OBJECT_ID_PATTERN.test(workspaceId)) {
    throw new Error("--workspace-id must be a 24-character ObjectId string.");
  }

  const cookies = await signIn({ baseUrl, email, name });
  const integrationPath = `/api/workspaces/${workspaceId}/integrations/${integrationId}`;
  const checks = [
    {
      method: "POST",
      path: `/api/workspaces/${workspaceId}/integrations`,
      body: {
        name: "RBAC Probe",
        domain: "rbac-probe.example.test",
        secrets: { TOKEN: "test" },
      },
    },
    {
      method: "PATCH",
      path: integrationPath,
      body: { secrets: { TOKEN: "test" } },
    },
    {
      method: "POST",
      path: integrationPath,
    },
    {
      method: "DELETE",
      path: integrationPath,
    },
  ];

  const results = [];
  for (const check of checks) {
    results.push(
      await expectForbidden({
        baseUrl,
        cookies,
        ...check,
      }),
    );
  }

  if (results.some((result) => !result)) {
    throw new Error("Member RBAC verification failed.");
  }

  console.log("Member integration mutation checks returned 403.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
