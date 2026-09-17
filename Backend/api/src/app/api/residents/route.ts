import { NextRequest, NextResponse } from "next/server";
import { assignedBarangayForUser, isSameBarangayForUser } from "@/lib/barangayScope";
import { logAuditEvent } from "@/lib/auditLogger";
import { auditActorForViewer, dashboardViewerRole, getDashboardViewer, type DashboardViewer } from "@/lib/dashboardViewer";
import { fullName, familyVulnerabilityPayload, pickResidentPayload } from "@/lib/residentPayload";
import { residentWithCurrentAge } from "@/lib/dateUtils";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return unauthorized();
    if (role !== "super" && role !== "cswdd" && role !== "barangay") return forbidden();

    const requestedBarangayId = parseBarangayId(new URL(req.url).searchParams.get("barangay_id"));
    if (requestedBarangayId.error) return NextResponse.json({ success: false, error: requestedBarangayId.error }, { status: 400 });
    const scopedBarangayId = role === "barangay" ? assignedBarangayForUser(viewer)?.barangay_id ?? null : requestedBarangayId.value;
    if (role === "barangay" && scopedBarangayId == null) return forbidden("Barangay assignment is required for this account.");

    let query = supabaseServer
      .from("residents_v3")
      .select("resident_id,application_id,last_name,first_name,middle_name,suffix,age,birth_date,sex,contact_number,complete_address,street,barangay_id,barangay_name,is_family_head,family_id,status,created_at,updated_at")
      .or("status.is.null,status.neq.inactive")
      .order("created_at", { ascending: false });

    if (scopedBarangayId != null) query = query.eq("barangay_id", scopedBarangayId);
    const { data, error } = await query;

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data: data?.map((resident: Record<string, unknown>) => residentWithCurrentAge(resident)) ?? [] });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return unauthorized();
    if (role !== "super" && role !== "barangay") return forbidden();

    const requestBody = await req.json();
    const body = scopedResidentBody(requestBody, viewer, role);
    if (!body) return forbidden("Barangay assignment is required for this account.");

    if (!body.last_name || !body.first_name || !body.complete_address || !body.barangay_id || !body.barangay_name) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    if (body.is_family_head) {
      const { data: resident, error: residentError } = await supabaseServer
        .from("residents_v3")
        .insert([{ ...pickResidentPayload(body, null), status: body.status ?? "active" }])
        .select()
        .single();

      if (residentError) return NextResponse.json({ success: false, error: residentError.message }, { status: 500 });

      const family_name = `${body.last_name} Family`;
      const { data: family, error: familyError } = await supabaseServer
        .from("families")
        .insert([{
          family_name,
          barangay_id: Number(body.barangay_id),
          barangay_name: String(body.barangay_name),
          complete_address: body.complete_address,
          street: body.street,
          created_by: body.created_by ?? null,
          ...familyVulnerabilityPayload(body),
        }])
        .select()
        .single();

      if (familyError) return NextResponse.json({ success: false, error: familyError.message }, { status: 500 });

      const familyHeadName = fullName(body);
      const { error: familyUpdateError } = await supabaseServer
        .from("families")
        .update({ family_head_id: resident.resident_id, family_head_name: familyHeadName })
        .eq("family_id", family.family_id);

      if (familyUpdateError) return NextResponse.json({ success: false, error: familyUpdateError.message }, { status: 500 });

      const { error: residentUpdateError } = await supabaseServer
        .from("residents_v3")
        .update({ family_id: family.family_id })
        .eq("resident_id", resident.resident_id);

      if (residentUpdateError) return NextResponse.json({ success: false, error: residentUpdateError.message }, { status: 500 });

      const actor = auditActorForViewer(viewer);
      await logAuditEvent({
        ...actor,
        action: "RESIDENT_CREATED",
        module: "Resident Information",
        description: `Created resident record for ${fullName(body)}.`,
        target_type: "resident",
        target_id: String(resident.resident_id),
        barangay_id: Number(body.barangay_id),
        barangay_name: String(body.barangay_name),
      });
      await logAuditEvent({
        ...actor,
        action: "FAMILY_UPDATED",
        module: "Resident Information",
        description: `Created family cluster and vulnerability counts for ${family_name}.`,
        target_type: "family",
        target_id: String(family.family_id),
        barangay_id: Number(body.barangay_id),
        barangay_name: String(body.barangay_name),
      });

      return NextResponse.json({
        success: true,
        data: {
          resident: residentWithCurrentAge({ ...resident, family_id: family.family_id }),
          family: { ...family, family_head_id: resident.resident_id, family_head_name: familyHeadName },
        },
      }, { status: 201 });
    }

    const familyId = body.selected_family_id ?? body.family_id;

    if (!familyId) {
      return NextResponse.json({ success: false, error: "selected_family_id or family_id is required for non-family-head" }, { status: 400 });
    }

    const familyScopeError = await validateFamilyScope(familyId, body);
    if (familyScopeError) return familyScopeError;

    const { data: resident, error: residentError } = await supabaseServer
      .from("residents_v3")
      .insert([{ ...pickResidentPayload(body, familyId), status: body.status ?? "active" }])
      .select()
      .single();

    if (residentError) return NextResponse.json({ success: false, error: residentError.message }, { status: 500 });

    await logAuditEvent({
      ...auditActorForViewer(viewer),
      action: "RESIDENT_CREATED",
      module: "Resident Information",
      description: `Created resident record for ${fullName(body)}.`,
      target_type: "resident",
      target_id: String(resident.resident_id),
      barangay_id: Number(body.barangay_id),
      barangay_name: String(body.barangay_name),
    });

    return NextResponse.json({ success: true, data: { resident: residentWithCurrentAge(resident) } }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

function scopedResidentBody(body: Record<string, unknown>, viewer: DashboardViewer, role: string | null) {
  if (role !== "barangay") return body;

  const barangay = assignedBarangayForUser(viewer);
  if (!barangay) return null;
  return {
    ...body,
    barangay_id: barangay.barangay_id,
    barangay_name: barangay.barangay_name,
    created_by: viewer.id,
  };
}

async function validateFamilyScope(familyId: unknown, resident: Record<string, unknown>) {
  const { data: family, error } = await supabaseServer
    .from("families")
    .select("family_id,barangay_id,barangay_name")
    .eq("family_id", familyId)
    .single();

  if (error || !family) {
    return NextResponse.json({ success: false, error: "Selected family cluster was not found." }, { status: 400 });
  }
  if (!isSameBarangayForUser(resident, family)) {
    return NextResponse.json({ success: false, error: "Selected family cluster must belong to the resident barangay." }, { status: 403 });
  }
  return null;
}

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
}

function forbidden(error = "You do not have access to manage resident records.") {
  return NextResponse.json({ success: false, error }, { status: 403 });
}

function parseBarangayId(raw: string | null) {
  if (raw == null || raw.trim() === "") return { value: undefined as number | undefined };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { value } : { error: "barangay_id must be a positive integer" };
}
