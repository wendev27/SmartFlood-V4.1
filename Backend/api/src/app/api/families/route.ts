// GET/POST /api/families
import { NextRequest, NextResponse } from "next/server";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  try {
    const viewer = await getDashboardViewer(req);
    const role = dashboardViewerRole(viewer);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (role !== "super" && role !== "cswdd" && role !== "barangay") {
      return NextResponse.json({ success: false, error: "You do not have access to family clusters." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const requestedBarangayId = parseBarangayId(searchParams.get("barangay_id"));
    if (requestedBarangayId.error) return NextResponse.json({ success: false, error: requestedBarangayId.error }, { status: 400 });
    const barangay_id = role === "barangay" ? assignedBarangayForUser(viewer)?.barangay_id ?? null : requestedBarangayId.value ?? null;
    if (role === "barangay" && barangay_id == null) return NextResponse.json({ success: false, error: "Barangay assignment is required for this account." }, { status: 403 });
    const search = searchParams.get("search");
    let query = supabaseServer
      .from("families")
      .select("family_id,family_name,family_head_id,family_head_name,barangay_id,barangay_name,street,complete_address,pwd_count,elderly_count,four_ps_count,lactating_count,pregnant_count,infant_count,toddler_count,total_family_members,created_at,updated_at")
      .order("created_at", { ascending: false });

    if (barangay_id != null) query = query.eq("barangay_id", barangay_id);
    if (search) {
      query = query.or(`family_name.ilike.%${search}%,family_head_name.ilike.%${search}%,complete_address.ilike.%${search}%,street.ilike.%${search}%`);
    }
    const { data, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

function parseBarangayId(raw: string | null) {
  if (raw == null || raw.trim() === "") return { value: undefined as number | undefined };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { value } : { error: "barangay_id must be a positive integer" };
}
