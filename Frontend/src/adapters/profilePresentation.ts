import type { DashboardRole } from "@/types/navigation";

/** Decorative seals selected from the signed-in user's barangay identity. */
export function profileSealForRole(role: DashboardRole | undefined, barangayName?: string | null): string | null {
  if (role === "cswdd") return "/images/cswdd/cswdd-seal.png";
  if (role !== "barangay") return null;
  const key = (barangayName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^barangay\s+/, "").trim();
  const seals: Record<string, string> = {
    longos: "/images/dashboard/barangay-longos-seal.png",
    catmon: "/images/dashboard/barangay-longos-seal.png",
    tanong: "/images/dashboard/barangay-tanong-seal.jpg",
    potrero: "/images/dashboard/barangay-potrero-seal.png",
  };
  return seals[key] ?? null;
}
