import { NextRequest, NextResponse } from "next/server";
import { auditActorFromBody, logAuditEvent, withoutAuditActor } from "@/lib/auditLogger";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { FamilyMemberValidationError, validateStructuredHouseholdMembers } from "@/lib/familyMembers";
import { supabaseServer } from "@/lib/supabaseServer";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (role !== "super" && role !== "cswdd" && role !== "barangay") return NextResponse.json({ success: false, error: "You do not have access to resident applications." }, { status: 403 });
    const searchParams = new URL(req.url).searchParams;
    const requestedBarangayId = parseBarangayId(searchParams.get("barangay_id"));
    if (requestedBarangayId.error) return NextResponse.json({ success: false, error: requestedBarangayId.error }, { status: 400 });
    const requestedApplicationId = searchParams.get("application_id")?.trim() ?? "";
    if (requestedApplicationId && !UUID_PATTERN.test(requestedApplicationId)) {
      return NextResponse.json({ success: false, error: "application_id must be a valid UUID" }, { status: 400 });
    }
    const scopedBarangayId = role === "barangay" ? assignedBarangayForUser(viewer)?.barangay_id ?? null : requestedBarangayId.value ?? null;
    if (role === "barangay" && scopedBarangayId == null) return NextResponse.json({ success: false, error: "Barangay assignment is required for this account." }, { status: 403 });
    let query = supabaseServer
      .from("resident_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (scopedBarangayId != null) query = query.eq("barangay_id", scopedBarangayId);
    if (requestedApplicationId) query = query.eq("application_id", requestedApplicationId);
    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

function parseBarangayId(raw: string | null) {
  if (raw == null || raw.trim() === "") return { value: undefined as number | undefined };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { value } : { error: "barangay_id must be a positive integer" };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const applicationPayload = withoutAuditActor(body);
    if (body.household_members !== undefined) {
      applicationPayload.household_members = validateStructuredHouseholdMembers(body.household_members);
    }
    const { data, error } = await supabaseServer
      .from("resident_applications")
      .insert([{ ...applicationPayload, status: body.status ?? "pending" }])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await logAuditEvent({
      ...auditActorFromBody(body),
      action: "APPLICATION_SUBMITTED",
      module: "Resident Account Registration Management",
      description: `Submitted resident application for ${[data.first_name, data.last_name].filter(Boolean).join(" ") || data.application_id}.`,
      target_type: "resident_application",
      target_id: String(data.application_id),
      barangay_id: data.barangay_id ?? null,
      barangay_name: data.barangay_name ?? null,
    });

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (error instanceof FamilyMemberValidationError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
