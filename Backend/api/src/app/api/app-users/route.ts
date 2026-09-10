import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auditActorFromBody, logAuditEvent } from "@/lib/auditLogger";
import { pickAppUserPayload, sanitizeAppUser } from "@/lib/appUserMapping";
import { getDashboardViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";

const privateResponseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

async function requireSuperAdmin(req: NextRequest) {
  const viewer = await getDashboardViewer(req);
  if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  if (viewer.role_id !== 1) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const denied = await requireSuperAdmin(req);
    if (denied) return denied;

    const { data, error } = await supabaseServer
      .from("app_users")
      .select("id,first_name,last_name,email,mobile_number,address,profile_image,created_at,updated_at,barangay,sex,role_id,barangay_id,status,failed_login_attempts,locked_until,last_login_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const barangayNames = await fetchBarangayNames();
    return NextResponse.json({
      success: true,
      data: (data ?? []).map((row: Record<string, unknown>) => sanitizeAppUser(row, barangayNames.get(Number(row.barangay_id)))),
    }, { headers: privateResponseHeaders });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireSuperAdmin(req);
    if (denied) return denied;

    const body = await req.json();
    const validationError = validateCreateBody(body);
    if (validationError) {
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }

    const payload = pickAppUserPayload(body);
    const passwordHash = await bcrypt.hash(String(body.password), 12);

    const { data, error } = await supabaseServer
      .from("app_users")
      .insert({
        ...payload,
        password_hash: passwordHash,
        failed_login_attempts: 0,
        locked_until: null,
      })
      .select("id,first_name,last_name,email,mobile_number,address,profile_image,created_at,updated_at,barangay,sex,role_id,barangay_id,status,failed_login_attempts,locked_until,last_login_at")
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const barangayNames = await fetchBarangayNames();
    const sanitized = sanitizeAppUser(data, barangayNames.get(Number(data?.barangay_id)));
    await logAuditEvent({
      ...auditActorFromBody(body),
      action: "ACCOUNT_CREATED",
      module: "Account Management",
      description: `Created account for ${[sanitized.first_name, sanitized.last_name].filter(Boolean).join(" ") || sanitized.email}.`,
      target_type: "app_user",
      target_id: sanitized.id,
      barangay_id: sanitized.barangay_id,
      barangay_name: sanitized.barangay_name,
    });

    return NextResponse.json({
      success: true,
      data: sanitized,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

function validateCreateBody(body: Record<string, unknown>) {
  if (!String(body.first_name ?? "").trim()) return "First name is required.";
  if (!String(body.last_name ?? "").trim()) return "Last name is required.";
  if (!String(body.email ?? "").trim()) return "Email is required.";
  if (!String(body.mobile_number ?? "").trim()) return "Mobile number is required.";
  if (!String(body.password ?? "").trim()) return "Password is required.";
  if (body.role_id == null || body.role_id === "") return "Role is required.";
  if (Number(body.role_id) === 4 && (body.barangay_id == null || body.barangay_id === "")) {
    return "Barangay is required for Barangay Official accounts.";
  }
  return "";
}

async function fetchBarangayNames() {
  const names = new Map<number, string>();
  const { data } = await supabaseServer.from("barangays").select("id,barangay_id,name,barangay_name");

  for (const row of data ?? []) {
    const id = Number(row.barangay_id ?? row.id);
    const name = String(row.barangay_name ?? row.name ?? "");
    if (Number.isFinite(id) && name) names.set(id, name);
  }

  return names;
}
