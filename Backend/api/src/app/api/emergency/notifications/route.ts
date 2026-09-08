import { NextRequest, NextResponse } from "next/server";
import { assignedBarangayForUser } from "@/lib/barangayScope";
import { dashboardViewerRole, getDashboardViewer } from "@/lib/dashboardViewer";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const viewer = await getDashboardViewer(request);
    const role = dashboardViewerRole(viewer);
    if (!viewer) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    if (!role) {
      return NextResponse.json({ success: false, error: "Your account role is not allowed to access emergency notifications." }, { status: 403 });
    }

    let query = supabaseServer
      .from("notifications")
      .select("notification_id,type,target_type,target_barangay_id,source_type,source_id,title,message,status,read_at,accepted_at,rejected_at,created_at")
      .eq("target_type", "barangay")
      .order("created_at", { ascending: false });

    if (role === "barangay") {
      const barangay = assignedBarangayForUser(viewer);
      if (!barangay) {
        return NextResponse.json({ success: false, error: "Your account is not assigned to a barangay." }, { status: 403 });
      }
      query = query.eq("target_barangay_id", barangay.barangay_id);
    } else if (role !== "super" && role !== "cswdd") {
      return NextResponse.json({ success: false, error: "You do not have access to emergency notifications." }, { status: 403 });
    } else {
      const requestedBarangayId = parseBarangayId(request.nextUrl.searchParams.get("barangay_id"));
      if (requestedBarangayId.error) {
        return NextResponse.json({ success: false, error: requestedBarangayId.error }, { status: 400 });
      }
      if (requestedBarangayId.value !== undefined) {
        const { data: barangay, error: barangayError } = await supabaseServer
          .from("barangays")
          .select("barangay_id")
          .eq("barangay_id", requestedBarangayId.value)
          .maybeSingle();
        if (barangayError) return NextResponse.json({ success: false, error: barangayError.message }, { status: 500 });
        if (!barangay) return NextResponse.json({ success: false, error: "Selected barangay was not found." }, { status: 400 });
        query = query.eq("target_barangay_id", requestedBarangayId.value);
      }
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const notifications = await attachAllocationDetails((data ?? []) as Record<string, unknown>[]);
    return NextResponse.json({ success: true, data: { notifications } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to load emergency notifications." }, { status: 500 });
  }
}

function parseBarangayId(raw: string | null) {
  if (raw == null || raw.trim() === "") return { value: undefined as number | undefined };
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? { value } : { error: "barangay_id must be a positive integer" };
}

async function attachAllocationDetails(notifications: Record<string, unknown>[]) {
  const itemIds = notifications
    .filter((notification) => notification.source_type === "emergency_allocation_item")
    .map((notification) => String(notification.source_id ?? ""))
    .filter(Boolean);

  if (itemIds.length === 0) {
    return notifications.map((notification) => ({ ...notification, allocation_item: null, batch: null }));
  }

  const { data: items, error: itemError } = await supabaseServer
    .from("emergency_allocation_items")
    .select("item_id,batch_id,barangay_id,barangay_name,family_food_packs,individual_relief_goods,emergency_kits,barangay_status,accepted_at,rejected_at,receipt_confirmed_at,created_at")
    .in("item_id", itemIds);

  if (itemError) throw new Error(itemError.message);

  const itemsById = new Map<string, Record<string, unknown>>((items ?? []).map((item: Record<string, unknown>) => [String(item.item_id), item]));
  const batchIds = Array.from(new Set((items ?? []).map((item: Record<string, unknown>) => String(item.batch_id ?? "")).filter(Boolean)));
  const batchesById = new Map<string, Record<string, unknown>>();

  if (batchIds.length > 0) {
    const { data: batches, error: batchError } = await supabaseServer
      .from("emergency_allocation_batches")
      .select("batch_id,plan_id,plan_name,status,created_at,accepted_at")
      .in("batch_id", batchIds);

    if (batchError) throw new Error(batchError.message);
    for (const row of batches ?? []) {
      const batch = row as Record<string, unknown>;
      batchesById.set(String(batch.batch_id), batch);
    }
  }

  return notifications.map((notification) => {
    const item = itemsById.get(String(notification.source_id ?? "")) ?? null;
    return {
      ...notification,
      allocation_item: item,
      batch: item ? batchesById.get(String(item.batch_id ?? "")) ?? null : null,
    };
  });
}
