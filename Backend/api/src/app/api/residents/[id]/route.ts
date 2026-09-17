import { NextRequest, NextResponse } from "next/server";
import { assignedBarangayForUser, isSameBarangayForUser } from "@/lib/barangayScope";
import { logAuditEvent } from "@/lib/auditLogger";
import { auditActorForViewer, dashboardViewerRole, getDashboardViewer, type DashboardViewer } from "@/lib/dashboardViewer";
import { fullName, pickResidentPayload } from "@/lib/residentPayload";
import { residentWithCurrentAge } from "@/lib/dateUtils";
import { supabaseServer } from "@/lib/supabaseServer";

const allowedPatchFields = new Set([
  "last_name",
  "first_name",
  "middle_name",
  "suffix",
  "age",
  "sex",
  "contact_number",
  "complete_address",
  "street",
  "barangay_id",
  "barangay_name",
  "is_family_head",
  "family_id",
  "status",
  "pwd_count",
  "elderly_count",
  "four_ps_count",
  "lactating_count",
  "pregnant_count",
  "infant_count",
  "toddler_count",
]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return unauthorized();
    if (role !== "super" && role !== "barangay") return forbidden();

    const requestBody = await req.json();

    const { data: existingResident, error: existingError } = await supabaseServer
      .from("residents_v3")
      .select("*")
      .eq("resident_id", id)
      .single();

    if (existingError) return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    if (role === "barangay" && !isSameBarangayForUser(viewer, existingResident)) return forbidden();

    const body = scopedResidentBody(requestBody, viewer, role);
    if (!body) return forbidden("Barangay assignment is required for this account.");
    if (!body.last_name || !body.first_name || !body.complete_address || !body.barangay_id || !body.barangay_name) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const allowedBody = Object.fromEntries(
      Object.entries(body).filter(([key]) => allowedPatchFields.has(key)),
    );
    const payload = pickResidentPayload(allowedBody);

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ success: false, error: "No allowed fields to update" }, { status: 400 });
    }

    const requestedFamilyId = payload.family_id ?? existingResident.family_id ?? body.family_id;
    if (requestedFamilyId) {
      const familyScopeError = await validateFamilyScope(requestedFamilyId, body);
      if (familyScopeError) return familyScopeError;
    }

    const { data: resident, error } = await supabaseServer
      .from("residents_v3")
      .update(payload)
      .eq("resident_id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const isFamilyHead = Boolean(body.is_family_head);
    const familyId = resident.family_id ?? existingResident.family_id ?? body.family_id;

    if (!isFamilyHead || !familyId) {
      await logAuditEvent({
        ...auditActorForViewer(viewer),
        action: "RESIDENT_UPDATED",
        module: "Resident Information",
        description: `Updated resident record for ${fullName(body)}.`,
        target_type: "resident",
        target_id: String(resident.resident_id),
        barangay_id: Number(body.barangay_id),
        barangay_name: String(body.barangay_name),
      });
      return NextResponse.json({ success: true, data: { resident: residentWithCurrentAge(resident) } });
    }

    const familyPayload = {
      family_head_name: fullName(body),
      barangay_id: Number(body.barangay_id),
      barangay_name: String(body.barangay_name),
      street: body.street ?? "",
      complete_address: body.complete_address,
      pwd_count: Number(body.pwd_count ?? 0),
      elderly_count: Number(body.elderly_count ?? 0),
      four_ps_count: Number(body.four_ps_count ?? 0),
      lactating_count: Number(body.lactating_count ?? 0),
      pregnant_count: Number(body.pregnant_count ?? 0),
      infant_count: Number(body.infant_count ?? 0),
      toddler_count: Number(body.toddler_count ?? 0),
      updated_at: new Date().toISOString(),
    };

    const { data: family, error: familyError } = await supabaseServer
      .from("families")
      .update(familyPayload)
      .eq("family_id", familyId)
      .select()
      .single();

    if (familyError) return NextResponse.json({ success: false, error: familyError.message }, { status: 500 });

    const actor = auditActorForViewer(viewer);
    await logAuditEvent({
      ...actor,
      action: "RESIDENT_UPDATED",
      module: "Resident Information",
      description: `Updated resident record for ${fullName(body)} and updated family vulnerability counts.`,
      target_type: "resident",
      target_id: String(resident.resident_id),
      barangay_id: Number(body.barangay_id),
      barangay_name: String(body.barangay_name),
    });
    await logAuditEvent({
      ...actor,
      action: "FAMILY_UPDATED",
      module: "Resident Information",
      description: `Updated family vulnerability counts for ${family.family_name ?? familyId}.`,
      target_type: "family",
      target_id: String(familyId),
      barangay_id: Number(body.barangay_id),
      barangay_name: String(body.barangay_name),
    });

    return NextResponse.json({ success: true, data: { resident: residentWithCurrentAge(resident), family } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return unauthorized();
    if (role !== "super" && role !== "barangay") return forbidden();

    const { data: existingResident, error: existingError } = await supabaseServer
      .from("residents_v3")
      .select("resident_id,barangay_id,barangay_name")
      .eq("resident_id", id)
      .single();

    if (existingError) return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    if (role === "barangay" && !isSameBarangayForUser(viewer, existingResident)) return forbidden();

    const { data, error } = await supabaseServer
      .from("residents_v3")
      .update({ status: "inactive" })
      .eq("resident_id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    await logAuditEvent({
      ...auditActorForViewer(viewer),
      action: "RESIDENT_DEACTIVATED",
      module: "Resident Information",
      description: `Deactivated resident record for ${fullName(data ?? {}) || id}.`,
      target_type: "resident",
      target_id: id,
      barangay_id: data?.barangay_id ?? null,
      barangay_name: data?.barangay_name ?? null,
    });
    return NextResponse.json({ success: true, data: data ? residentWithCurrentAge(data) : data });
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

function forbidden(error = "You do not have access to manage this resident record.") {
  return NextResponse.json({ success: false, error }, { status: 403 });
}
