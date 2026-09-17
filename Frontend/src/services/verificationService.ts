import type { ApplicationFormValues } from "@/types/verification";
import { fetchJson } from "@/services/apiClient";

export async function getVerificationApplications(barangayId?: number) {
  const query = barangayId ? `?barangay_id=${barangayId}` : "";
  return fetchJson<Record<string, unknown>[]>(`/api/resident-applications${query}`);
}

export async function getVerificationApplication(applicationId: string, barangayId?: number) {
  const params = new URLSearchParams({ application_id: applicationId });
  if (barangayId) params.set("barangay_id", String(barangayId));
  const applications = await fetchJson<Record<string, unknown>[]>(`/api/resident-applications?${params.toString()}`);
  return applications.find((application) => String(application.application_id ?? "") === applicationId) ?? null;
}

export async function getApplicationFormDefaults() {
  return Promise.resolve<ApplicationFormValues>({
    surname: "",
    firstName: "",
    middleName: "",
    contactNumber: "",
    ageSex: "",
    occupation: "",
    completeAddress: "",
    barangay: "",
    totalFamilyMembers: "",
    householdHead: "",
    specialNeeds: "",
    medicalConditions: "",
  });
}
