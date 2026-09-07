import { NextRequest, NextResponse } from "next/server";
import { auditActorFromBody, logAuditEvent } from "@/lib/auditLogger";
import { assignedBarangayForUser, isSameBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { fullName, familyVulnerabilityPayload, pickResidentPayload } from "@/lib/residentPayload";
import { supabaseServer } from "@/lib/supabaseServer";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (role !== "super" && role !== "cswdd" && role !== "barangay") return NextResponse.json({ success: false, error: "You do not have access to review resident applications." }, { status: 403 });
    const action = body.action;

    if (action !== "approved" && action !== "rejected") {
      return NextResponse.json({ success: false, error: "action must be approved or rejected" }, { status: 400 });
    }

    const { data: application, error: applicationError } = await supabaseServer
      .from("resident_applications")
      .select("*")
      .eq("application_id", id)
      .single();

    if (applicationError) {
      return NextResponse.json({ success: false, error: applicationError.message }, { status: 500 });
    }

    const selectedScope = role === "barangay" ? assignedBarangayForUser(viewer) : body.barangay_id == null ? null : { barangay_id: Number(body.barangay_id), barangay_name: body.barangay_name };
    if (selectedScope && (!Number.isInteger(selectedScope.barangay_id) || !isSameBarangayForUser(selectedScope, application))) {
      return NextResponse.json({ success: false, error: "This application is outside the selected barangay scope." }, { status: 404 });
    }

    if (application.status === "approved" || application.status === "rejected") {
      return NextResponse.json({ success: false, error: "This application has already been reviewed." }, { status: 400 });
    }

    const reviewedAt = new Date().toISOString();
    const reviewFields = {
      status: action,
      admin_review_notes: body.admin_review_notes ?? null,
      reviewed_by: body.reviewed_by ?? null,
      reviewed_at: reviewedAt,
    };

    if (action === "rejected") {
      const { data, error } = await supabaseServer
        .from("resident_applications")
        .update(reviewFields)
        .eq("application_id", id)
        .select()
        .single();

      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

      await logAuditEvent({
        ...auditActorFromBody(body),
        action: "APPLICATION_REJECTED",
        module: "Resident Account Registration Management",
        description: `Rejected resident application for ${fullName(application)}.`,
        target_type: "resident_application",
        target_id: String(id),
        barangay_id: application.barangay_id ?? null,
        barangay_name: application.barangay_name ?? null,
      });

      return NextResponse.json({ success: true, data });
    }

    const residentBase = {
      ...application,
      application_id: application.application_id,
      source: application.source ?? "resident_application",
      status: "active",
      created_by: body.reviewed_by ?? application.created_by ?? null,
    };

    if (application.is_family_head) {
      const { data: resident, error: residentError } = await supabaseServer
        .from("residents_v3")
        .insert([{ ...pickResidentPayload(residentBase, null), is_family_head: true }])
        .select()
        .single();

      if (residentError) return NextResponse.json({ success: false, error: residentError.message }, { status: 500 });

      const { data: family, error: familyError } = await supabaseServer
        .from("families")
        .insert([{
          family_name: application.family_name ?? `${application.last_name ?? "Resident"} Family`,
          barangay_id: application.barangay_id,
          barangay_name: application.barangay_name,
          complete_address: application.complete_address,
          street: application.street,
          created_by: body.reviewed_by ?? application.created_by ?? null,
          ...familyVulnerabilityPayload(application),
        }])
        .select()
        .single();

      if (familyError) return NextResponse.json({ success: false, error: familyError.message }, { status: 500 });

      const { error: familyUpdateError } = await supabaseServer
        .from("families")
        .update({ family_head_id: resident.resident_id, family_head_name: fullName(application) })
        .eq("family_id", family.family_id);

      if (familyUpdateError) return NextResponse.json({ success: false, error: familyUpdateError.message }, { status: 500 });

      const { error: residentUpdateError } = await supabaseServer
        .from("residents_v3")
        .update({ family_id: family.family_id })
        .eq("resident_id", resident.resident_id);

      if (residentUpdateError) return NextResponse.json({ success: false, error: residentUpdateError.message }, { status: 500 });

      const { data: reviewedApplication, error: reviewError } = await supabaseServer
        .from("resident_applications")
        .update(reviewFields)
        .eq("application_id", id)
        .select()
        .single();

      if (reviewError) return NextResponse.json({ success: false, error: reviewError.message }, { status: 500 });

      await logAuditEvent({
        ...auditActorFromBody(body),
        action: "APPLICATION_APPROVED",
        module: "Resident Account Registration Management",
        description: `Approved resident application for ${fullName(application)}.`,
        target_type: "resident_application",
        target_id: String(id),
        barangay_id: application.barangay_id ?? null,
        barangay_name: application.barangay_name ?? null,
      });

      return NextResponse.json({ success: true, data: { application: reviewedApplication, resident: { ...resident, family_id: family.family_id }, family } });
    }

    const familyId = body.selected_family_id ?? application.selected_family_id ?? application.family_id;

    if (!familyId) {
      return NextResponse.json({ success: false, error: "selected_family_id is required to approve a non-family-head application" }, { status: 400 });
    }

    const { data: resident, error: residentError } = await supabaseServer
      .from("residents_v3")
      .insert([{ ...pickResidentPayload(residentBase, familyId), is_family_head: false }])
      .select()
      .single();

    if (residentError) return NextResponse.json({ success: false, error: residentError.message }, { status: 500 });

    const { data: reviewedApplication, error: reviewError } = await supabaseServer
      .from("resident_applications")
      .update(reviewFields)
      .eq("application_id", id)
      .select()
      .single();

    if (reviewError) return NextResponse.json({ success: false, error: reviewError.message }, { status: 500 });

    await logAuditEvent({
      ...auditActorFromBody(body),
      action: "APPLICATION_APPROVED",
      module: "Resident Account Registration Management",
      description: `Approved resident application for ${fullName(application)}.`,
      target_type: "resident_application",
      target_id: String(id),
      barangay_id: application.barangay_id ?? null,
      barangay_name: application.barangay_name ?? null,
    });

    return NextResponse.json({ success: true, data: { application: reviewedApplication, resident } });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
