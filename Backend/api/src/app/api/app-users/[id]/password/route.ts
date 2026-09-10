import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auditActorFromBody, logAuditEvent } from "@/lib/auditLogger";
import { getDashboardViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (viewer.role_id !== 1) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });

    const { id } = await context.params;
    const body = await req.json();
    const newPassword = String(body.new_password ?? "").trim();

    if (!newPassword) {
      return NextResponse.json({ success: false, error: "New password is required." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { data, error } = await supabaseServer
      .from("app_users")
      .update({
        password_hash: passwordHash,
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq("id", id)
      .select("id,first_name,last_name,email,role_id,barangay_id,barangay")
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    await logAuditEvent({
      ...auditActorFromBody(body),
      action: "ACCOUNT_PASSWORD_CHANGED",
      module: "Account Management",
      description: `Changed password for ${[data?.first_name, data?.last_name].filter(Boolean).join(" ") || data?.email || id}.`,
      target_type: "app_user",
      target_id: id,
      barangay_id: data?.barangay_id ?? null,
      barangay_name: String(data?.barangay ?? ""),
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
