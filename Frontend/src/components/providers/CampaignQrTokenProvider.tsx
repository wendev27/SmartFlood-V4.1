"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type CampaignQrToken = {
  batchId: string;
  token: string;
};

type CampaignQrTokenContextValue = {
  campaignQrToken: CampaignQrToken | null;
  setCampaignQrToken: (value: CampaignQrToken | null) => void;
};

const CampaignQrTokenContext = createContext<CampaignQrTokenContextValue | null>(null);

export function CampaignQrTokenProvider({ children }: { children: ReactNode }) {
  const [campaignQrToken, setCampaignQrToken] = useState<CampaignQrToken | null>(null);

  return (
    <CampaignQrTokenContext.Provider value={{ campaignQrToken, setCampaignQrToken }}>
      {children}
    </CampaignQrTokenContext.Provider>
  );
}

export function useCampaignQrToken() {
  const context = useContext(CampaignQrTokenContext);
  if (!context) throw new Error("useCampaignQrToken must be used within CampaignQrTokenProvider");
  return context;
}
