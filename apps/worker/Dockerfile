FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git curl ripgrep poppler-utils bubblewrap \
  && rm -rf /var/lib/apt/lists/*

ARG CLAUDE_CODE_VERSION=2.1.154
ARG CODEX_CLI_VERSION=0.125.0
ARG OPENCODE_VERSION=1.14.24
# Claude Agent SDK currently uses its embedded Claude Code executable for runs.
# The global Claude install is for PATH-based runtime detection; replace this
# with one clear Claude executable strategy after the multi-runtime ship.
RUN npm install -g \
  "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  "@openai/codex@${CODEX_CLI_VERSION}" \
  "opencode-ai@${OPENCODE_VERSION}"

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Run as non-root user for security
RUN useradd -m -s /bin/bash worker
RUN mkdir -p /tmp/second-workspaces && chown worker:worker /tmp/second-workspaces
USER worker

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "start"]
