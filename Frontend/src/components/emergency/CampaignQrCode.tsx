"use client";

import type { Ref } from "react";
import { QRCodeSVG } from "qrcode.react";

export function CampaignQrCode({ token, size = 280, svgRef }: { token: string; size?: number; svgRef?: Ref<SVGSVGElement> }) {
  return <QRCodeSVG ref={svgRef} value={token} size={size} level="M" marginSize={4}
    title="Relief campaign QR code" style={{ maxWidth: "100%", height: "auto", background: "white" }} />;
}

export function downloadCampaignQr(svg: SVGSVGElement | null, batchId: string) {
  if (!svg) return;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `smartflood-${batchId}-qr.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
