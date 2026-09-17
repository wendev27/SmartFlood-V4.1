import { NextRequest, NextResponse } from "next/server";
import { isSameBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { FamilyMemberValidationError, validateStructuredHouseholdMembers } from "@/lib/familyMembers";
import { supabaseServer } from "@/lib/supabaseServer";

const MEMBER_WRITE_ROLES = new Set(["super", "barangay"]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return response({ success: false, error: "Unauthorized." }, 401);
    if (!role || !MEMBER_WRITE_ROLES.has(role)) return response({ success: false, error: "You do not have access to manage household members." }, 403);

    const { id: residentId } = await context.params;
    const { data: resident, error: residentError } = await supabaseServer
      .from("residents_v3")
      .select("resident_id,family_id,barangay_id,barangay_name")
      .eq("resident_id", residentId)
      .maybeSingle();

    if (residentError) return response({ success: false, error: residentError.message }, 500);
    if (!resident) return response({ success: false, error: "Resident was not found." }, 404);
    if (role === "barangay" && !isSameBarangayForUser(viewer, resident)) return response({ success: false, error: "This resident is outside your barangay scope." }, 403);
    if (!resident.family_id) return response({ success: false, error: "The resident is not assigned to a family cluster." }, 409);

    const input = await req.json();
    if (!isRecord(input)) return response({ success: false, error: "Household member must be an object." }, 400);
    const [member] = validateStructuredHouseholdMembers([{
      member_id: input.member_id,
      full_name: input.full_name,
      birth_date: input.birth_date ?? null,
      resident_id: null,
      is_pwd: input.is_pwd ?? false,
      is_pregnant: input.is_pregnant ?? false,
      pregnancy_weeks: input.pregnancy_weeks ?? null,
      is_lactating: input.is_lactating ?? false,
      is_4ps: input.is_4ps ?? false,
    }]);

    const { data: existing, error: existingError } = await supabaseServer
      .from("family_members")
      .select("member_id,family_id,source_application_id")
      .eq("member_id", member.member_id)
      .maybeSingle();

    if (existingError) return response({ success: false, error: existingError.message }, 500);
    if (existing) {
      return response({ success: false, error: "This household member ID already exists." }, 409);
    }

    const { data, error } = await supabaseServer
      .from("family_members")
      .insert([{
        member_id: member.member_id,
        family_id: resident.family_id,
        resident_id: null,
        source_application_id: null,
        full_name: member.full_name,
        birth_date: member.birth_date,
        is_pwd: member.is_pwd,
        is_pregnant: member.is_pregnant,
        pregnancy_weeks: member.pregnancy_weeks,
        is_lactating: member.is_lactating,
        is_4ps: member.is_4ps,
      }])
      .select()
      .single();

    if (error) return response({ success: false, error: error.message }, 500);
    return response({ success: true, data });
  } catch (error) {
    return handleError(error);
  }
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
