"use client";

import { useEffect, useState } from "react";
import { getReliefCampaignHistory } from "@/services/emergencyService";
import type { ReliefCampaign } from "@/types/emergency";
import { CampaignQrCode } from "@/components/emergency/CampaignQrCode";
import { useCampaignQrToken } from "@/components/emergency/useCampaignQrToken";
import styles from "./scanner.module.css";

type PageState = "loading" | "idle";

export default function ReliefDistributionScannerPage() {
  const [campaign, setCampaign] = useState<ReliefCampaign | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState<string | null>(null);

  const qr = useCampaignQrToken(campaign?.batch_id ?? null);

  const barangayName = campaignScopeLabel(campaign);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedBatchId = params.get("batchId") ?? "";
    async function loadCampaign() {
      try {
        setState("loading");
        setError(null);
        const campaigns = await getReliefCampaignHistory();
        const selected = campaigns.find((row) => row.batch_id === selectedBatchId) ?? null;
        setCampaign(selected);
        if (!selected) setError("Selected relief campaign was not found or is not available to this account.");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load selected relief campaign.");
      } finally {
        setState("idle");
      }
    }

    loadCampaign();
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span>SmartFlood</span>
            <h1>Scan QR Code for the Users</h1>
          </div>
          <strong>{campaign ? formatStatus(campaign.status) : state === "loading" ? "Loading" : "Unavailable"}</strong>
        </header>

        <section className={styles.campaignBar}>
          <div>
            <span>Selected Campaign</span>
            <strong>{campaign?.plan_name ?? "No campaign selected"}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{campaign ? formatStatus(campaign.status) : "-"}</strong>
          </div>
          <div>
            <span>Barangay</span>
            <strong>{barangayName}</strong>
          </div>
        </section>

        {error ? <p className={styles.errorMessage}>{error}</p> : null}

        <section className={styles.qrCard} aria-label="Campaign QR code">
          <header>
            <span>Campaign QR Code</span>
            <h2>Scan QR Code for the Users</h2>
            <p>Users can scan this QR code with their phone to access this relief distribution.</p>
          </header>
          <div className={styles.qrFrame}>
            {qr.token ? <CampaignQrCode token={qr.token} /> : <p className={styles.emptyState}>{qr.loading ? "Loading campaign QR..." : qr.error ?? "Campaign QR is unavailable."}</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

function campaignScopeLabel(campaign: ReliefCampaign | null) {
  const barangays = campaign?.progress?.barangays ?? [];
  if (barangays.length === 1) return barangays[0]?.barangay_name || "Assigned barangay";
  if (barangays.length > 1) return `${barangays.length} barangays`;
  return "Assigned barangay";
}

function formatStatus(value?: string | null) {
  const text = String(value ?? "").replace(/_/g, " ").trim();
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : "Unknown";
}
