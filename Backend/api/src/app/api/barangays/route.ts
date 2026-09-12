import { NextRequest, NextResponse } from "next/server";
import { getDashboardViewer, isCommandCenterViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";

const privateResponseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
type BarangayOption = { barangay_id: number; barangay_name: string };

export async function GET(req: NextRequest) {
  try {
    const viewer = await getDashboardViewer(req);
    if (!viewer) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    if (!isCommandCenterViewer(viewer)) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });

    const { data, error } = await supabaseServer
      .from("barangays")
      .select("barangay_id,barangay_name")
      .order("barangay_id", { ascending: true });

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const rows: BarangayOption[] = (data ?? [])
      .map((row: Record<string, unknown>) => ({
        barangay_id: Number(row.barangay_id),
        barangay_name: String(row.barangay_name ?? "").trim(),
      }))
      .filter((row: BarangayOption) => Number.isSafeInteger(row.barangay_id) && row.barangay_id > 0 && row.barangay_name);

    return NextResponse.json({ success: true, data: rows }, { headers: privateResponseHeaders });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to load barangays." }, { status: 500 });
  }
}
