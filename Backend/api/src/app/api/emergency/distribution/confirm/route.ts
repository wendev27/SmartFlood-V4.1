import { NextRequest, NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auditLogger";
import { auditActorForViewer, getDashboardViewer } from "@/lib/dashboardViewer";
import { duplicateDistributionError, resolveDistributionContext } from "@/lib/emergencyDistribution";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  try {
    const viewer = await getDashboardViewer(request);
    if (!viewer) {
      return NextResponse.json({ success: false, result: "UNAUTHORIZED", error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const identifier = String(body.qr_identifier ?? body.identifier ?? body.resident_id ?? body.family_id ?? "").trim();
    const context = await resolveDistributionContext(viewer, {
      identifier,
      allocation_item_id: stringifyOrNull(body.allocation_item_id),
      batch_id: stringifyOrNull(body.batch_id ?? body.batchId),
      qr_token: stringifyOrNull(body.qr_token ?? body.qrToken),
    });

    if (context.status !== "ELIGIBLE") {
      return NextResponse.json({
        success: false,
        result: context.status,
        error: context.reason ?? "Beneficiary is not eligible for distribution.",
        data: {
          beneficiary: "beneficiary" in context ? context.beneficiary ?? null : null,
          allocation: "allocation" in context ? context.allocation ?? null : null,
          existing_distribution: "existing_distribution" in context ? context.existing_distribution ?? null : null,
        },
      }, { status: context.status === "UNAUTHORIZED" ? 403 : 400 });
    }
    if (!context.beneficiary || !context.allocation) {
      return NextResponse.json({ success: false, result: "INVALID_IDENTIFIER", error: "Distribution eligibility context is incomplete." }, { status: 500 });
    }

    const beneficiary = context.beneficiary;
    const allocation = context.allocation;

    const now = new Date().toISOString();
    const { data: distribution, error } = await supabaseServer
      .from("relief_distributions")
      .insert([{
        batch_id: allocation.batch_id,
        allocation_item_id: allocation.item_id,
        family_id: beneficiary.family_id,
        family_head_id: beneficiary.family_head_id || null,
        barangay_id: beneficiary.barangay_id,
        status: "received",
        verified_by: viewer.id,
        verified_at: now,
      }])
      .select("distribution_id,batch_id,allocation_item_id,family_id,family_head_id,barangay_id,status,verified_by,verified_at,created_at")
      .single();

    if (error) {
      if (duplicateDistributionError(error)) {
        const duplicateContext = await resolveDistributionContext(viewer, {
          identifier,
          allocation_item_id: allocation.item_id,
          batch_id: allocation.batch_id,
        });
        return NextResponse.json({
          success: false,
          result: "ALREADY_RECEIVED",
          error: "This family has already received relief for this emergency allocation.",
          data: {
            beneficiary: "beneficiary" in duplicateContext ? duplicateContext.beneficiary ?? beneficiary : beneficiary,
            allocation: "allocation" in duplicateContext ? duplicateContext.allocation ?? allocation : allocation,
            existing_distribution: "existing_distribution" in duplicateContext ? duplicateContext.existing_distribution ?? null : null,
          },
        }, { status: 409 });
      }
      return NextResponse.json({ success: false, result: "INVALID_IDENTIFIER", error: error.message }, { status: 500 });
    }

    await logAuditEvent({
      ...auditActorForViewer(viewer),
      action: "RELIEF_DISTRIBUTION_CONFIRMED",
      module: "Emergency / Distribution",
      description: `Confirmed emergency relief distribution for ${beneficiary.family_name} in ${beneficiary.barangay_name}.`,
      target_type: "family",
      target_id: beneficiary.family_id,
      barangay_id: beneficiary.barangay_id,
      barangay_name: beneficiary.barangay_name,
    });

    return NextResponse.json({
      success: true,
      result: "RECEIVED",
      data: {
        distribution: {
          ...distribution,
          family_name: beneficiary.family_name,
          family_head_name: beneficiary.family_head_name,
          barangay_name: beneficiary.barangay_name,
          verified_by_name: [viewer.first_name, viewer.last_name].filter(Boolean).join(" ") || viewer.email,
        },
        beneficiary,
        allocation,
      },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, result: "INVALID_IDENTIFIER", error: error instanceof Error ? error.message : "Unable to confirm relief distribution." }, { status: 500 });
  }
}

function stringifyOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
