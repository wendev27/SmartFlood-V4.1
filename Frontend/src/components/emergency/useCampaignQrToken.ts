"use client";

import { useEffect, useState } from "react";
import { getReliefCampaignQrToken } from "@/services/emergencyService";

export function useCampaignQrToken(batchId: string | null) {
  const [value, setValue] = useState<{ batchId: string | null; token: string | null; error: string | null }>({ batchId: null, token: null, error: null });
  useEffect(() => {
    let cancelled = false;
    if (!batchId) return;
    getReliefCampaignQrToken(batchId).then(
      (token) => { if (!cancelled) setValue({ batchId, token, error: null }); },
      (error: unknown) => { if (!cancelled) setValue({ batchId, token: null, error: error instanceof Error ? error.message : "Unable to load campaign QR." }); },
    );
    return () => { cancelled = true; };
  }, [batchId]);
  // Never expose another campaign's token while the selected campaign changes.
  return batchId && value.batchId === batchId
    ? { token: value.token, error: value.error, loading: false }
    : { token: null, error: null, loading: Boolean(batchId) };
}
