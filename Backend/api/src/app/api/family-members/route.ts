import { NextRequest, NextResponse } from "next/server";
import { isSameBarangayForUser } from "@/lib/barangayScope";
import { APPROVED_DEMOGRAPHIC_AGE_POLICY, calculateCurrentAge, classifyCurrentAge } from "@/lib/dateUtils";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { familyMemberWithCurrentPregnancyWeeks } from "@/lib/familyMembers";
import { supabaseServer } from "@/lib/supabaseServer";

const MEMBER_READ_ROLES = new Set(["super", "cswdd", "barangay"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return response({ success: false, error: "Unauthorized." }, 401);
    if (!role || !MEMBER_READ_ROLES.has(role)) {
      return response({ success: false, error: "You do not have access to household members." }, 403);
    }

    const familyId = new URL(req.url).searchParams.get("family_id")?.trim() ?? "";
    if (!UUID_PATTERN.test(familyId)) {
      return response({ success: false, error: "family_id must be a valid UUID." }, 400);
    }

    const { data: family, error: familyError } = await supabaseServer
      .from("families")
      .select("family_id,barangay_id,barangay_name")
      .eq("family_id", familyId)
      .maybeSingle();

    if (familyError) return response({ success: false, error: familyError.message }, 500);
    if (!family) return response({ success: false, error: "Family cluster was not found." }, 404);
    if (role === "barangay" && !isSameBarangayForUser(viewer, family)) {
      return response({ success: false, error: "This family is outside your barangay scope." }, 403);
    }

    const { data, error } = await supabaseServer
      .from("family_members")
      .select("member_id,family_id,resident_id,source_application_id,full_name,birth_date,is_pwd,is_pregnant,pregnancy_weeks,pregnancy_baseline_at,is_lactating,is_4ps,created_at,updated_at")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true });

    if (error) return response({ success: false, error: error.message }, 500);
    const asOf = new Date();
    const enrichedMembers = (data ?? []).map((member: Record<string, unknown>) => {
      const birthDate = typeof member.birth_date === "string" ? member.birth_date : null;
      const currentAge = birthDate ? calculateCurrentAge(birthDate, asOf) : null;
      const classification = classifyCurrentAge(currentAge, APPROVED_DEMOGRAPHIC_AGE_POLICY, {
        birthDate: birthDate ?? undefined,
        asOf,
      });
      return familyMemberWithCurrentPregnancyWeeks({
        ...member,
        current_age: currentAge,
        age_source: birthDate && currentAge !== null ? "birth_date" : "unavailable",
        classification: classification.classification,
      }, asOf);
    });
    return response({ success: true, data: enrichedMembers });
  } catch (error) {
    return response({ success: false, error: (error as Error).message }, 500);
  }
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
