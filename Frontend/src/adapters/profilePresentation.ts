import type { DashboardRole } from "@/types/navigation";

/** Decorative seals selected from the signed-in user's barangay identity. */
export function profileSealForRole(role: DashboardRole | undefined, barangayName?: string | null, barangayId?: number | null): string | null {
  if (role === "cswdd") return "/images/cswdd/cswdd-seal.png";
  if (role !== "barangay") return null;
  const sealsById: Record<number, string> = {
    1: "/images/dashboard/barangay-tanong-seal.jpg",
    2: "/images/dashboard/barangay-longos-seal.png",
    3: "/images/dashboard/barangay-potrero-seal.png",
  };
  if (barangayId != null && sealsById[barangayId]) return sealsById[barangayId];
  const key = (barangayName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^barangay\s+/, "").trim();
  const sealsByName: Record<string, string> = {
    longos: sealsById[2],
    tanong: sealsById[1],
    potrero: sealsById[3],
  };
  return sealsByName[key] ?? null;
}
