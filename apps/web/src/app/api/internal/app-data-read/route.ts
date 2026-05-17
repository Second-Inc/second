import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import {
  agentsPayloadAllowsDataCollection,
  getDraftAgentsJsonApproval,
} from "@/lib/agents/agents-governance";
import {
  findAppById,
  getAppDataDoc,
  getAppSourceFilesForVersion,
  listAppData,
} from "@/lib/db";
import {
  appDataScopeId,
  normalizeAppSourceVersion,
} from "@/lib/app-data-scope";

type AppDataReadRequest = {
  workspaceId: string;
  appId: string;
  sourceVersion?: "draft" | "published";
  agentId?: string;
  collection: string;
  docId?: string;
};

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  let body: AppDataReadRequest;
  try {
    body = (await request.json()) as AppDataReadRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { workspaceId, appId, collection, docId } = body;

  if (!workspaceId || !appId || !body.agentId || !collection) {
    return NextResponse.json(
      {
        success: false,
        error: "workspaceId, appId, agentId, and collection are required",
      },
      { status: 400 },
    );
  }

  try {
    const sourceVersion = normalizeAppSourceVersion(body.sourceVersion);
    const app = await findAppById({ workspaceId, appId });
    if (!app) {
      return NextResponse.json(
        { success: false, error: "App was not found for approved agents.json enforcement" },
        { status: 403 },
      );
    }
    if (sourceVersion === "draft") {
      const sourceFiles = await getAppSourceFilesForVersion({
        workspaceId,
        appId,
        version: "draft",
      });
      const approval = getDraftAgentsJsonApproval({
        app,
        sourceFiles,
      });
      if (
        !approval?.approved ||
        !agentsPayloadAllowsDataCollection(
          app.agentsJsonApprovedPayload,
          collection,
          body.agentId,
        )
      ) {
        return NextResponse.json(
          { success: false, error: "Draft agents.json must approve this data collection" },
          { status: 403 },
        );
      }
    } else if (
      !app.publishedAgentsJsonApprovedPayload ||
      !agentsPayloadAllowsDataCollection(
        app.publishedAgentsJsonApprovedPayload,
        collection,
        body.agentId,
      )
    ) {
      return NextResponse.json(
        { success: false, error: "Collection is not part of the published approved agents.json" },
        { status: 403 },
      );
    }
    const dataAppId = appDataScopeId(
      appId,
      sourceVersion,
    );
    if (docId) {
      const doc = await getAppDataDoc(
        workspaceId,
        dataAppId,
        collection,
        docId,
      );
      if (!doc) {
        return NextResponse.json({ success: true, doc: null });
      }
      return NextResponse.json({
        success: true,
        doc: { _id: doc._id, ...doc.data },
      });
    }

    const docs = await listAppData(workspaceId, dataAppId, collection);
    return NextResponse.json({
      success: true,
      docs: docs.map((d) => ({ _id: d._id, ...d.data })),
    });
  } catch (err) {
    console.error("[app-data-read] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
