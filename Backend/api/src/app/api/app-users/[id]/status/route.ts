import { NextRequest, NextResponse } from "next/server";
import { auditActorFromBody, logAuditEvent } from "@/lib/auditLogger";
import { getDashboardViewer, isCommandCenterViewer } from "@/lib/dashboardViewer";
import { allowedAccountStatuses, normalizeAccountStatus } from "@/lib/appUserMapping";
import { supabaseServer } from "@/lib/supabaseServer";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (!isCommandCenterViewer(viewer)) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });

    const { id } = await context.params;
    const body = await req.json();
    const status = normalizeAccountStatus(body.status);

    if (!allowedAccountStatuses.has(status)) {
      return NextResponse.json({ success: false, error: "Status must be active, inactive, or blocked." }, { status: 400 });
    }

    const payload: Record<string, unknown> = { status };
    if (status === "active") {
      payload.locked_until = null;
      payload.failed_login_attempts = 0;
    }

    const { data, error } = await supabaseServer
      .from("app_users")
      .update(payload)
      .eq("id", id)
      .select("id,first_name,last_name,email,barangay_id,barangay")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    await logAuditEvent({
      ...auditActorFromBody(body),
      action: "ACCOUNT_STATUS_CHANGED",
      module: "Account Management",
      description: `Changed account status for ${[data?.first_name, data?.last_name].filter(Boolean).join(" ") || data?.email || id} to ${status}.`,
      target_type: "app_user",
      target_id: id,
      barangay_id: data?.barangay_id ?? null,
      barangay_name: String(data?.barangay ?? ""),
    });
    return NextResponse.json({ success: true, data: { id, status } });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
