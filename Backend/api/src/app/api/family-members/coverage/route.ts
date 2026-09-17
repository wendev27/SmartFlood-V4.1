import { NextRequest, NextResponse } from "next/server";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { buildFamilyDemographicComparison } from "@/lib/familyMembers";
import { supabaseServer } from "@/lib/supabaseServer";

const REVIEW_ROLES = new Set(["super", "cswdd", "barangay"]);

export async function GET(req: NextRequest) {
  const noStore = { headers: { "Cache-Control": "no-store" } };

  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401, ...noStore });
    if (!role || !REVIEW_ROLES.has(role)) {
      return NextResponse.json({ success: false, error: "You do not have access to family-member coverage." }, { status: 403, ...noStore });
    }

    const requestedBarangayId = parseBarangayId(new URL(req.url).searchParams.get("barangay_id"));
    if (requestedBarangayId.error) return NextResponse.json({ success: false, error: requestedBarangayId.error }, { status: 400, ...noStore });

    const scopedBarangayId = role === "barangay"
      ? assignedBarangayForUser(viewer)?.barangay_id ?? null
      : requestedBarangayId.value ?? null;
    if (role === "barangay" && scopedBarangayId == null) {
      return NextResponse.json({ success: false, error: "Barangay assignment is required for this account." }, { status: 403, ...noStore });
    }

    let familyQuery = supabaseServer
      .from("families")
      .select("family_id,total_family_members,infant_count,toddler_count,elderly_count,barangay_id,barangay_name")
      .order("created_at", { ascending: true });
    if (scopedBarangayId != null) familyQuery = familyQuery.eq("barangay_id", scopedBarangayId);

    const { data: families, error: familyError } = await familyQuery;
    if (familyError) return NextResponse.json({ success: false, error: familyError.message }, { status: 500, ...noStore });

    const familyRows = (families ?? []) as Array<Record<string, unknown>>;
    const familyIds = familyRows.map((family) => String(family.family_id ?? "")).filter(Boolean);
    if (familyIds.length === 0) {
      return NextResponse.json({ success: true, data: buildFamilyDemographicComparison(familyRows, [], []) }, noStore);
    }

    const [{ data: residents, error: residentError }, { data: members, error: memberError }] = await Promise.all([
      supabaseServer
        .from("residents_v3")
        .select("resident_id,family_id")
        .in("family_id", familyIds),
      supabaseServer
        .from("family_members")
        .select("member_id,family_id,birth_date")
        .in("family_id", familyIds),
    ]);

    if (residentError) return NextResponse.json({ success: false, error: residentError.message }, { status: 500, ...noStore });
    if (memberError) return NextResponse.json({ success: false, error: memberError.message }, { status: 500, ...noStore });

    return NextResponse.json({
      success: true,
      data: buildFamilyDemographicComparison(
        familyRows,
        (residents ?? []) as Array<Record<string, unknown>>,
        (members ?? []) as Array<Record<string, unknown>>,
      ),
    }, noStore);
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500, ...noStore });
  }
}

function parseBarangayId(raw: string | null) {
  if (raw == null || raw.trim() === "") return { value: undefined as number | undefined };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { value } : { error: "barangay_id must be a positive integer" };
}
