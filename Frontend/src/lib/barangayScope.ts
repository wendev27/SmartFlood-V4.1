import { normalizeBarangayForCompare } from "@/lib/formatters";

export type BarangayScopedRecord = {
  barangay_id?: unknown;
  barangayId?: unknown;
  barangay_name?: unknown;
  barangayName?: unknown;
  barangay?: unknown;
  department?: unknown;
};

const barangayNamesById = new Map([
  ["1", "Barangay Tanong"],
  ["2", "Barangay Longos"],
  ["3", "Barangay Potrero"],
]);

export function barangayIdForName(name?: string | null) {
  const normalized = normalizeBarangayNameForScope(String(name ?? ""));
  const entry = Array.from(barangayNamesById.entries()).find(([, label]) => normalizeBarangayNameForScope(label) === normalized);
  return entry ? Number(entry[0]) : undefined;
}

export function isSameBarangayForUser(user: BarangayScopedRecord | null | undefined, record: BarangayScopedRecord | null | undefined) {
  const userBarangayId = stringify(user?.barangay_id ?? user?.barangayId);
  const recordBarangayId = stringify(record?.barangay_id ?? record?.barangayId);
  if (userBarangayId && recordBarangayId && userBarangayId === recordBarangayId) return true;

  const userBarangay = normalizeBarangayName(user);
  const recordBarangay = normalizeBarangayName(record);
  return Boolean(userBarangay) && Boolean(recordBarangay) && userBarangay === recordBarangay;
}

export function assignedBarangayForUser(user: BarangayScopedRecord | null | undefined) {
  const storedName = firstText(user?.barangay_name, user?.barangayName, user?.barangay, user?.department);
  const storedNameForCompare = normalizeBarangayNameForScope(storedName);
  const id = stringify(user?.barangay_id ?? user?.barangayId)
    || Array.from(barangayNamesById.entries()).find(([, name]) => normalizeBarangayNameForScope(name) === storedNameForCompare)?.[0]
    || "";
  const mappedName = id ? barangayNamesById.get(id) : undefined;
  const name = mappedName ?? storedName;
  if (!id || !name) return null;

  return {
    barangay_id: Number(id),
    barangay_name: name,
  };
}

function normalizeBarangayName(record: BarangayScopedRecord | null | undefined) {
  return normalizeBarangayNameForScope(firstText(record?.barangay_name, record?.barangayName, record?.barangay, record?.department));
}

function normalizeBarangayNameForScope(value: string) {
  return normalizeBarangayForCompare(value).replace(/^barangay\s+/, "");
}

function firstText(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
}

function stringify(value: unknown) {
  return value == null ? "" : String(value).trim();
}
