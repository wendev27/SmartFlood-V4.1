import { NextRequest, NextResponse } from "next/server";
import { auditActorFromBody, logAuditEvent } from "@/lib/auditLogger";
import { getDashboardViewer } from "@/lib/dashboardViewer";
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
    if (viewer.role_id !== 1) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });

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
    const sanitized = sanitizeAppUser(data);
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
