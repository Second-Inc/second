#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATUS_FILE="$REPO_DIR/.second-dev.txt"
SECOND_DEV_DIR="$REPO_DIR/.second-dev"
NO_AUTH_SESSION_SECRET_FILE="$SECOND_DEV_DIR/no-auth-session-secret"
WEB_APP_DIR="$REPO_DIR/apps/web"
WORKER_APP_DIR="$REPO_DIR/apps/worker"
NEXT_DEV_LOCK_FILE="$WEB_APP_DIR/.next/dev/lock"
PORTLESS_PACKAGE="${SECOND_DEV_PORTLESS_PACKAGE:-portless@0.12.0}"
PORTLESS_PROXY_PORT="${SECOND_DEV_PORTLESS_PROXY_PORT:-${PORTLESS_PORT:-1355}}"
PORTLESS_HTTPS_VALUE="${SECOND_DEV_PORTLESS_HTTPS:-${PORTLESS_HTTPS:-0}}"
PORTLESS_SYNC_HOSTS_VALUE="${SECOND_DEV_PORTLESS_SYNC_HOSTS:-${PORTLESS_SYNC_HOSTS:-0}}"
SECOND_POSTHOG_DISABLED_VALUE="${SECOND_POSTHOG_DISABLED:-}"
if [[ "${SECOND_TELEMETRY_DISABLED:-}" == "1" || "$SECOND_POSTHOG_DISABLED_VALUE" == "1" ]]; then
  SECOND_POSTHOG_DISABLED_VALUE="1"
fi

forward_args=()
for arg in "$@"; do
  case "$arg" in
    --disable-telemetry|--no-analytics)
      SECOND_POSTHOG_DISABLED_VALUE="1"
      ;;
    *)
      forward_args+=("$arg")
      ;;
  esac
done
if (( ${#forward_args[@]} > 0 )); then
  set -- "${forward_args[@]}"
else
  set --
fi

read_git_branch() {
  local git_meta="$REPO_DIR/.git"
  local git_dir=""
  local head=""

  if [[ -d "$git_meta" ]]; then
    git_dir="$git_meta"
  elif [[ -f "$git_meta" ]]; then
    local git_line=""
    IFS= read -r git_line < "$git_meta" || true
    if [[ "$git_line" == gitdir:* ]]; then
      git_dir="${git_line#gitdir: }"
      if [[ "$git_dir" != /* ]]; then
        git_dir="$REPO_DIR/$git_dir"
      fi
    fi
  fi

  if [[ -n "$git_dir" && -f "$git_dir/HEAD" ]]; then
    IFS= read -r head < "$git_dir/HEAD" || true
    if [[ "$head" == ref:\ refs/heads/* ]]; then
      printf "%s" "${head#ref: refs/heads/}"
    fi
  fi
}

slugify() {
  local value="${1:-worktree}"
  value="$(printf "%s" "$value" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"

  value="${value:-worktree}"
  printf "%.48s" "$value" | sed -E 's/-+$//'
}

path_hash() {
  printf "%s" "$REPO_DIR" | cksum | awk '{print $1}'
}

find_free_port() {
  node - "$1" "${2:-}" "${@:3}" <<'NODE'
const net = require("node:net");

const preferred = Number(process.argv[2] || 0);
const host = process.argv[3] || undefined;
const avoidedPorts = new Set(
  process.argv
    .slice(4)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0),
);

function listen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const options = host ? { host, port, exclusive: true } : { port, exclusive: true };

    server.once("error", () => resolve(undefined));
    server.listen(options, () => {
      const address = server.address();
      const selectedPort = typeof address === "object" && address ? address.port : port;
      server.close(() => resolve(selectedPort));
    });
  });
}

async function main() {
  if (preferred > 0 && !avoidedPorts.has(preferred)) {
    const selected = await listen(preferred);
    if (selected) {
      console.log(selected);
      return;
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selected = await listen(0);
    if (selected && !avoidedPorts.has(selected)) {
      console.log(selected);
      return;
    }
  }

  process.exit(1);
}

main();
NODE
}

read_or_create_no_auth_session_secret() {
  if [[ -n "${SECOND_NO_AUTH_SESSION_SECRET:-}" ]]; then
    printf "%s" "$SECOND_NO_AUTH_SESSION_SECRET"
    return
  fi

  mkdir -p "$SECOND_DEV_DIR"

  if [[ -s "$NO_AUTH_SESSION_SECRET_FILE" ]]; then
    local existing=""
    IFS= read -r existing < "$NO_AUTH_SESSION_SECRET_FILE" || true
    if [[ ${#existing} -ge 32 ]]; then
      printf "%s" "$existing"
      return
    fi
  fi

  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$NO_AUTH_SESSION_SECRET_FILE"
  chmod 600 "$NO_AUTH_SESSION_SECRET_FILE" 2>/dev/null || true
  cat "$NO_AUTH_SESSION_SECRET_FILE"
}

stop_existing_dev_processes_for_worktree() {
  local pids=""

  pids="$(node - "$WEB_APP_DIR" "$WORKER_APP_DIR" "$NEXT_DEV_LOCK_FILE" <<'NODE'
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");

const webAppDir = process.argv[2];
const workerAppDir = process.argv[3];
const lockFile = process.argv[4];
const matches = new Set();

try {
  const output = execFileSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });

  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const [, pid, command] = match;
    if (
      command.includes(`${webAppDir}/node_modules/.bin/next dev`) ||
      command.includes(`${webAppDir}/.next/dev/build/postcss.js`) ||
      command.includes(`${workerAppDir}/node_modules/.bin/tsx watch src/index.ts`) ||
      command.includes(`${workerAppDir}/node_modules/tsx/dist/loader.mjs src/index.ts`)
    ) {
      matches.add(pid);
    }
  }
} catch {}

try {
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    if (Number.isInteger(lock.pid) && lock.pid > 0) {
      matches.add(String(lock.pid));
    }
  }
} catch {}

process.stdout.write([...matches].join(" "));
NODE
)"

  if [[ -n "$pids" ]]; then
    echo "Stopping previous dev processes for this worktree: $pids"
    kill $pids 2>/dev/null || true
    sleep 1

    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi

  if [[ -f "$NEXT_DEV_LOCK_FILE" ]]; then
    rm -f "$NEXT_DEV_LOCK_FILE"
  fi
}

branch_name="$(read_git_branch)"
branch_slug="$(slugify "$branch_name")"
branch_slug="${branch_slug:0:32}"
branch_slug="$(printf "%s" "$branch_slug" | sed -E 's/-+$//')"
repo_hash="$(path_hash)"
default_dev_id="${branch_slug}-${repo_hash}"

SECOND_DEV_ID="$(slugify "${SECOND_DEV_ID:-$default_dev_id}")"
COMPOSE_PROJECT_NAME_VALUE="$(slugify "${COMPOSE_PROJECT_NAME:-second-$SECOND_DEV_ID}")"

default_portless_name="second"
if [[ -z "${branch_name:-}" ]]; then
  default_portless_name="second-$SECOND_DEV_ID"
fi
PORTLESS_NAME="${SECOND_DEV_PORTLESS_NAME:-$default_portless_name}"
should_use_portless="${SECOND_DEV_PORTLESS:-${PORTLESS:-1}}"

if [[ "$should_use_portless" != "0" && -z "${PORTLESS_URL:-}" ]]; then
  portless_cmd=()

  if [[ -x "$REPO_DIR/node_modules/.bin/portless" ]]; then
    portless_cmd=("$REPO_DIR/node_modules/.bin/portless")
  elif command -v portless >/dev/null 2>&1; then
    portless_cmd=("portless")
  elif command -v npx >/dev/null 2>&1 && [[ "${CI:-}" != "1" && -t 1 ]]; then
    if npx --yes "$PORTLESS_PACKAGE" --version >/dev/null 2>&1; then
      portless_cmd=("npx" "--yes" "$PORTLESS_PACKAGE")
    fi
  fi

  if [[ ${#portless_cmd[@]} -gt 0 ]]; then
    exec env \
      PORTLESS_PORT="$PORTLESS_PROXY_PORT" \
      PORTLESS_HTTPS="$PORTLESS_HTTPS_VALUE" \
      PORTLESS_SYNC_HOSTS="$PORTLESS_SYNC_HOSTS_VALUE" \
      "${portless_cmd[@]}" run --name "$PORTLESS_NAME" bash "$SCRIPT_DIR/dev.sh" "$@"
  fi

  echo "portless is not available; continuing with an auto-picked localhost port."
fi

WEB_HOST="${WEB_HOST:-${HOST:-127.0.0.1}}"
WORKER_HOST_VALUE="${WORKER_HOST:-127.0.0.1}"

WEB_PORT="${WEB_PORT:-${PORT:-}}"
if [[ -z "$WEB_PORT" ]]; then
  WEB_PORT="$(find_free_port 3000 "$WEB_HOST")"
fi

WORKER_PORT="${WORKER_PORT:-$(find_free_port 3001 "$WORKER_HOST_VALUE" "$WEB_PORT")}"
MONGO_PORT="${MONGO_PORT:-0}"
REDIS_PORT="${REDIS_PORT:-0}"

SECOND_AUTH_MODE_VALUE="${SECOND_AUTH_MODE:-none}"
SECOND_NO_AUTH_SESSION_SECRET_VALUE="$(read_or_create_no_auth_session_secret)"
SECOND_PUBLIC_URL_VALUE="${SECOND_PUBLIC_URL:-${PORTLESS_URL:-http://localhost:${WEB_PORT}}}"
WORKER_URL_VALUE="${WORKER_URL:-http://127.0.0.1:${WORKER_PORT}}"
WEB_URL_VALUE="${WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
TOOL_EXECUTE_URL_VALUE="${TOOL_EXECUTE_URL:-${WEB_URL_VALUE}/api/internal/tool-execute}"
MONGODB_URI_VALUE="${MONGODB_URI:-pending}"
REDIS_URL_VALUE="${REDIS_URL:-pending}"

worker_pid=""
infra_started="0"

write_status_file() {
  local status="$1"

  {
    printf "# Generated by npm run dev. Gitignored. Safe to delete.\n"
    printf "status=%s\n" "$status"
    printf "dev_id=%s\n" "$SECOND_DEV_ID"
    printf "branch=%s\n" "${branch_name:-unknown}"
    printf "url=%s\n" "$SECOND_PUBLIC_URL_VALUE"
    printf "web_url=%s\n" "$WEB_URL_VALUE"
    printf "worker_url=%s\n" "$WORKER_URL_VALUE"
    printf "worker_host=%s\n" "$WORKER_HOST_VALUE"
    printf "compose_project=%s\n" "$COMPOSE_PROJECT_NAME_VALUE"
    printf "web_port=%s\n" "$WEB_PORT"
    printf "worker_port=%s\n" "$WORKER_PORT"
    printf "mongo_port=%s\n" "$MONGO_PORT"
    printf "redis_port=%s\n" "$REDIS_PORT"
    printf "portless_url=%s\n" "${PORTLESS_URL:-}"
    printf "started_at=%s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  } > "$STATUS_FILE"
}

published_port() {
  local service="$1"
  local target_port="$2"
  local value=""

  value="$(docker compose -p "$COMPOSE_PROJECT_NAME_VALUE" port "$service" "$target_port" | tail -n 1 || true)"
  value="${value##*:}"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Could not resolve published port for $service:$target_port" >&2
    exit 1
  fi

  printf "%s" "$value"
}

cleanup() {
  trap - EXIT INT TERM

  if [[ -n "$worker_pid" ]] && kill -0 "$worker_pid" 2>/dev/null; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi

  if [[ "$infra_started" == "1" && "${SECOND_DEV_KEEP_INFRA:-0}" != "1" ]]; then
    docker compose -p "$COMPOSE_PROJECT_NAME_VALUE" down --remove-orphans >/dev/null 2>&1 || true
  fi

  write_status_file "stopped"
}

interrupt() {
  cleanup
  exit 130
}

trap cleanup EXIT
trap interrupt INT TERM

cd "$REPO_DIR"

stop_existing_dev_processes_for_worktree
write_status_file "starting"

echo "Second dev URL: $SECOND_PUBLIC_URL_VALUE"
echo "Dev status file: $STATUS_FILE"
echo "Compose project: $COMPOSE_PROJECT_NAME_VALUE"

if ! MONGO_PORT="$MONGO_PORT" REDIS_PORT="$REDIS_PORT" \
  docker compose -p "$COMPOSE_PROJECT_NAME_VALUE" up --detach --wait --force-recreate --remove-orphans mongo redis; then
  echo ""
  echo "Failed to start MongoDB and Redis via Docker Compose."
  echo "Make sure Docker Desktop is running, or start your local Docker daemon first."
  exit 1
fi
infra_started="1"

MONGO_PORT="$(published_port mongo 27017)"
REDIS_PORT="$(published_port redis 6379)"
MONGODB_URI_VALUE="${MONGODB_URI:-mongodb://127.0.0.1:${MONGO_PORT}/second?directConnection=true&replicaSet=rs0}"
REDIS_URL_VALUE="${REDIS_URL:-redis://127.0.0.1:${REDIS_PORT}}"
write_status_file "infra-ready"

env \
  PORT="$WORKER_PORT" \
  WORKER_HOST="$WORKER_HOST_VALUE" \
  WORKER_URL="$WORKER_URL_VALUE" \
  WEB_URL="$WEB_URL_VALUE" \
  TOOL_EXECUTE_URL="$TOOL_EXECUTE_URL_VALUE" \
  npm --prefix apps/worker run dev &
worker_pid="$!"

write_status_file "running"

env \
  SECOND_AUTH_MODE="$SECOND_AUTH_MODE_VALUE" \
  SECOND_NO_AUTH_SESSION_SECRET="$SECOND_NO_AUTH_SESSION_SECRET_VALUE" \
  MONGODB_URI="$MONGODB_URI_VALUE" \
  SECOND_PUBLIC_URL="$SECOND_PUBLIC_URL_VALUE" \
  WORKER_URL="$WORKER_URL_VALUE" \
  WEB_URL="$WEB_URL_VALUE" \
  TOOL_EXECUTE_URL="$TOOL_EXECUTE_URL_VALUE" \
  REDIS_URL="$REDIS_URL_VALUE" \
  SECOND_POSTHOG_TOKEN="${SECOND_POSTHOG_TOKEN:-}" \
  SECOND_POSTHOG_HOST="${SECOND_POSTHOG_HOST:-}" \
  SECOND_POSTHOG_DISABLED="$SECOND_POSTHOG_DISABLED_VALUE" \
  SECOND_TELEMETRY_DISABLED="${SECOND_TELEMETRY_DISABLED:-$SECOND_POSTHOG_DISABLED_VALUE}" \
  SECOND_SENTRY_DSN="${SECOND_SENTRY_DSN:-}" \
  NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN:-}" \
  SENTRY_DSN="${SENTRY_DSN:-}" \
  SECOND_SENTRY_DISABLED="${SECOND_SENTRY_DISABLED:-}" \
  SECOND_ERROR_REPORTING_DISABLED="${SECOND_ERROR_REPORTING_DISABLED:-}" \
  npm --prefix apps/web run dev -- --hostname "$WEB_HOST" --port "$WEB_PORT"
