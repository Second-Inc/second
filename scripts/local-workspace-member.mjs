#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { MongoClient, ObjectId } = require("mongodb");

const ROLES = new Set(["owner", "admin", "member"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

function databaseNameFromUri(uri) {
  const url = new URL(uri);
  const databaseName = url.pathname.replace(/^\//, "").split("/")[0];
  if (!databaseName) {
    throw new Error("MONGODB_URI must include a database name.");
  }
  return decodeURIComponent(databaseName);
}

async function ensureDefaultTeam(db, workspace, actorUserId) {
  const teams = db.collection("workspace_teams");
  const workspaces = db.collection("workspaces");
  const existing = await teams.findOne({
    workspaceId: workspace._id,
    $or: [{ isDefault: true }, { slug: "general" }],
  });

  if (existing) {
    await workspaces.updateOne(
      {
        _id: workspace._id,
        $or: [{ defaultTeamId: { $exists: false } }, { defaultTeamId: null }],
      },
      {
        $set: {
          defaultTeamId: existing._id,
          updatedAt: new Date(),
        },
      },
    );
    return existing;
  }

  const now = new Date();
  const team = {
    _id: new ObjectId().toHexString(),
    workspaceId: workspace._id,
    name: "General",
    slug: "general",
    isDefault: true,
    createdByUserId: actorUserId ?? workspace.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  await teams.insertOne(team);
  await workspaces.updateOne(
    { _id: workspace._id },
    {
      $set: {
        defaultTeamId: team._id,
        updatedAt: now,
      },
    },
  );
  return team;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceId = requireArg(args, "workspace-id").toLowerCase();
  const email = requireArg(args, "email");
  const displayName = requireArg(args, "name");
  const role = args.get("role")?.trim() || "member";
  const mongodbUri = process.env.MONGODB_URI;

  if (process.env.SECOND_AUTH_MODE && process.env.SECOND_AUTH_MODE !== "none") {
    throw new Error(
      "This script is only intended for SECOND_AUTH_MODE=none local testing.",
    );
  }

  if (!mongodbUri) {
    throw new Error("MONGODB_URI is required.");
  }

  if (!OBJECT_ID_PATTERN.test(workspaceId)) {
    throw new Error("--workspace-id must be a 24-character ObjectId string.");
  }

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error("--email must be a valid email address.");
  }

  if (displayName.length < 2 || displayName.length > 80) {
    throw new Error("--name must be between 2 and 80 characters.");
  }

  if (!ROLES.has(role)) {
    throw new Error("--role must be one of owner, admin, or member.");
  }

  const client = new MongoClient(mongodbUri);
  await client.connect();

  try {
    const db = client.db(databaseNameFromUri(mongodbUri));
    const workspace = await db.collection("workspaces").findOne({
      _id: workspaceId,
    });

    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const now = new Date();
    const emailNormalized = email.trim().toLowerCase();
    await db.collection("users").updateOne(
      { emailNormalized },
      {
        $set: {
          email: email.trim(),
          emailNormalized,
          displayName: displayName.trim(),
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId().toHexString(),
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const user = await db.collection("users").findOne({ emailNormalized });
    if (!user) throw new Error("Failed to upsert local user.");

    const team = await ensureDefaultTeam(db, workspace, user._id);

    await db.collection("workspace_memberships").updateOne(
      { workspaceId, userId: user._id },
      {
        $set: {
          role,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId().toHexString(),
          workspaceId,
          userId: user._id,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection("workspace_team_memberships").updateOne(
      { workspaceId, teamId: team._id, userId: user._id },
      {
        $setOnInsert: {
          _id: new ObjectId().toHexString(),
          workspaceId,
          teamId: team._id,
          userId: user._id,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    console.log(`Seeded ${emailNormalized} as ${role} in ${workspace.name}.`);
    console.log(`Default team: ${team.name} (${team._id})`);
    console.log("Next: sign out, open /onboarding/identity, and use this email.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
