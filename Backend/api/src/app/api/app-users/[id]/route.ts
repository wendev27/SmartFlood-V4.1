import { NextRequest, NextResponse } from "next/server";
import { auditActorFromBody, logAuditEvent } from "@/lib/auditLogger";
import { getDashboardViewer, isCommandCenterViewer } from "@/lib/dashboardViewer";
import { pickAppUserPayload, sanitizeAppUser } from "@/lib/appUserMapping";
import { supabaseServer } from "@/lib/supabaseServer";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const allowedPatchFields = new Set([
  "first_name",
  "last_name",
  "email",
  "mobile_number",
  "address",
  "sex",
  "role_id",
  "barangay_id",
  "status",
]);

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (!isCommandCenterViewer(viewer)) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });

    const { id } = await context.params;
    const body = await req.json();
    const allowedBody = Object.fromEntries(
      Object.entries(body).filter(([key]) => allowedPatchFields.has(key)),
    );
    const payload = pickAppUserPayload(allowedBody);

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ success: false, error: "No allowed fields to update." }, { status: 400 });
    }

    if (Number(payload.role_id) === 4 && (payload.barangay_id == null || payload.barangay_id === "")) {
      return NextResponse.json({ success: false, error: "Barangay is required for Barangay Official accounts." }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from("app_users")
      .update(payload)
      .eq("id", id)
      .select("id,first_name,last_name,email,mobile_number,address,profile_image,created_at,updated_at,barangay,sex,role_id,barangay_id,status,failed_login_attempts,locked_until,last_login_at")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    const barangayNames = await fetchBarangayNames();
    const sanitized = sanitizeAppUser(data, barangayNames.get(Number(data.barangay_id)));
    await logAuditEvent({
      ...auditActorFromBody(body),
      action: "ACCOUNT_UPDATED",
      module: "Account Management",
      description: `Updated account for ${[sanitized.first_name, sanitized.last_name].filter(Boolean).join(" ") || sanitized.email}.`,
      target_type: "app_user",
      target_id: sanitized.id,
      barangay_id: sanitized.barangay_id,
      barangay_name: sanitized.barangay_name,
    });
    return NextResponse.json({ success: true, data: sanitized });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

async function fetchBarangayNames() {
  const names = new Map<number, string>();
  const { data } = await supabaseServer.from("barangays").select("barangay_id,barangay_name");

  for (const row of data ?? []) {
    const id = Number(row.barangay_id);
    const name = String(row.barangay_name ?? "").trim();
    if (Number.isFinite(id) && name) names.set(id, name);
  }

  return names;
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (!isCommandCenterViewer(viewer)) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });

    const { id } = await context.params;
    if (id === viewer.id) return NextResponse.json({ success: false, error: "You cannot deactivate your own account." }, { status: 400 });

    // Keep the account row because audit logs, allocations, and workflow records
    // reference app_users with restrictive foreign keys. Deactivation removes
    // login access without breaking historical relationships.
    const { data, error } = await supabaseServer
      .from("app_users")
      .update({ status: "inactive" })
      .eq("id", id)
      .select("id,first_name,last_name,email,role_id,barangay_id,status")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    await logAuditEvent({
      ...auditActorFromBody(await req.json().catch(() => ({}))),
      action: "ACCOUNT_DEACTIVATED",
      module: "Account Management",
      description: `Deactivated account for ${[data.first_name, data.last_name].filter(Boolean).join(" ") || data.email}.`,
      target_type: "app_user",
      target_id: String(data.id),
      barangay_id: data.barangay_id,
    });

    return NextResponse.json({ success: true, data: { id: String(data.id), status: "inactive" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to deactivate account." }, { status: 500 });
  }
}
