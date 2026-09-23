import { NextRequest, NextResponse } from "next/server";
import { auditActorForViewer, dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import {
  createAcceptedWorkflowBatch,
  findEquivalentAcceptedBatch,
  validateAllocationPlan,
  WorkflowValidationError,
} from "@/lib/emergencyWorkflow";

const APPROVAL_ERROR = "Failed to approve AI recommendations through deployed AI backend.";

function aiBackendUrl() {
  return (process.env.AI_BACKEND_URL ?? "").replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  try {
    // This route is the Human-in-the-Loop gate: a signed-in super/CSWDD user
    // must approve one validated draft before recommendations and emergency
    // allocation workflow records are persisted.
    const viewer = await getDashboardViewer(request);
    const role = dashboardViewerRole(viewer);
    if (!viewer) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    if (role !== "super" && role !== "cswdd") {
      return NextResponse.json({ success: false, error: "You do not have access to approve AI relief recommendations." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const plan = validateAllocationPlan(body.plan);
    const existing = await findEquivalentAcceptedBatch(plan);
    if (existing) {
      return NextResponse.json({ success: true, ...existing });
    }

    const backendUrl = aiBackendUrl();
    if (!backendUrl) {
      return NextResponse.json(
        { success: false, error: `${APPROVAL_ERROR} AI_BACKEND_URL is not configured.` },
        { status: 500 },
      );
    }

    const response = await fetch(`${backendUrl}/api/ai/recommendations/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: body.plan, audit_actor: auditActorForViewer(viewer) }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => null) as { success?: boolean; data?: unknown; error?: string } | null;

    if (!response.ok || result?.success === false) {
      return NextResponse.json(
        { success: false, error: result?.error ? `${APPROVAL_ERROR} ${result.error}` : APPROVAL_ERROR },
        { status: response.ok ? 502 : response.status },
      );
    }

    // The accepted plan is copied into the durable emergency workflow only
    // after the AI service has saved its recommendation-history rows.
    const savedRecommendations = Array.isArray(result?.data) ? result.data.filter(isRecord) : [];
    const workflow = await createAcceptedWorkflowBatch(plan, savedRecommendations, viewer);
    return NextResponse.json({ success: true, ...workflow });
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    const details = error instanceof Error ? error.message : "Unknown backend request error.";
    return NextResponse.json({ success: false, error: `${APPROVAL_ERROR} ${details}` }, { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
