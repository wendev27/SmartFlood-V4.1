import { NextRequest, NextResponse } from "next/server";
import { isSameBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { FamilyMemberValidationError, validateStructuredHouseholdMembers } from "@/lib/familyMembers";
import { supabaseServer } from "@/lib/supabaseServer";

const MEMBER_WRITE_ROLES = new Set(["super", "barangay"]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return response({ success: false, error: "Unauthorized." }, 401);
    if (!role || !MEMBER_WRITE_ROLES.has(role)) return response({ success: false, error: "You do not have access to manage household members." }, 403);

    const { id } = await context.params;
    const existing = await getMember(id);
    if (existing.error) return response({ success: false, error: existing.error }, existing.status);
    if (!existing.member) return response({ success: false, error: "Household member was not found." }, 404);

    const family = await getFamily(existing.member.family_id);
    if (family.error) return response({ success: false, error: family.error }, family.status);
    if (!family.data) return response({ success: false, error: "Family cluster was not found." }, 404);
    if (role === "barangay" && !isSameBarangayForUser(viewer, family.data)) return response({ success: false, error: "This household member is outside your barangay scope." }, 403);

    const input = await req.json();
    if (!isRecord(input)) return response({ success: false, error: "Household member must be an object." }, 400);
    const [member] = validateStructuredHouseholdMembers([{
      member_id: existing.member.member_id,
      full_name: input.full_name ?? existing.member.full_name,
      birth_date: input.birth_date !== undefined ? input.birth_date : existing.member.birth_date,
      resident_id: existing.member.resident_id,
      is_pwd: input.is_pwd ?? existing.member.is_pwd,
      is_pregnant: input.is_pregnant ?? existing.member.is_pregnant,
      pregnancy_weeks: input.pregnancy_weeks !== undefined ? input.pregnancy_weeks : existing.member.pregnancy_weeks,
      is_lactating: input.is_lactating ?? existing.member.is_lactating,
      is_4ps: input.is_4ps ?? existing.member.is_4ps,
    }]);

    const { data, error } = await supabaseServer
      .from("family_members")
      .update({
        full_name: member.full_name,
        birth_date: member.birth_date,
        is_pwd: member.is_pwd,
        is_pregnant: member.is_pregnant,
        pregnancy_weeks: member.pregnancy_weeks,
        is_lactating: member.is_lactating,
        is_4ps: member.is_4ps,
        updated_at: new Date().toISOString(),
      })
      .eq("member_id", existing.member.member_id)
      .select()
      .single();

    if (error) return response({ success: false, error: error.message }, 500);
    return response({ success: true, data });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return response({ success: false, error: "Unauthorized." }, 401);
    if (!role || !MEMBER_WRITE_ROLES.has(role)) return response({ success: false, error: "You do not have access to manage household members." }, 403);

    const { id } = await context.params;
    const existing = await getMember(id);
    if (existing.error) return response({ success: false, error: existing.error }, existing.status);
    if (!existing.member) return response({ success: false, error: "Household member was not found." }, 404);

    const family = await getFamily(existing.member.family_id);
    if (family.error) return response({ success: false, error: family.error }, family.status);
    if (!family.data) return response({ success: false, error: "Family cluster was not found." }, 404);
    if (role === "barangay" && !isSameBarangayForUser(viewer, family.data)) return response({ success: false, error: "This household member is outside your barangay scope." }, 403);

    const { error } = await supabaseServer
      .from("family_members")
      .delete()
      .eq("member_id", existing.member.member_id);

    if (error) return response({ success: false, error: error.message }, 500);
    return response({ success: true, data: { member_id: existing.member.member_id } });
  } catch (error) {
    return response({ success: false, error: (error as Error).message }, 500);
  }
}

async function getMember(id: string) {
  const { data, error } = await supabaseServer
    .from("family_members")
    .select("member_id,family_id,resident_id,source_application_id,full_name,birth_date,is_pwd,is_pregnant,pregnancy_weeks,is_lactating,is_4ps")
    .eq("member_id", id)
    .maybeSingle();
  if (error) return { member: null, error: error.message, status: 500 };
  return { member: data as Record<string, unknown> | null, error: "", status: 200 };
}

async function getFamily(familyId: unknown) {
  const { data, error } = await supabaseServer
    .from("families")
    .select("family_id,barangay_id,barangay_name")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) return { data: null, error: error.message, status: 500 };
  return { data: data as Record<string, unknown> | null, error: "", status: 200 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function handleError(error: unknown) {
  if (error instanceof FamilyMemberValidationError) {
    return response({ success: false, error: error.message }, error.status);
  }
  return response({ success: false, error: (error as Error).message }, 500);
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
