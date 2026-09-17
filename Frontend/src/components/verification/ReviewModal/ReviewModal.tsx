import { Modal } from "@/components/ui/Modal/Modal";
import { Button } from "@/components/ui/Button/Button";
import { formatBarangayName } from "@/lib/formatters";
import { SHOW_STRUCTURED_HOUSEHOLD_MEMBERS } from "@/lib/featureFlags";
import { getHouseholdMemberAgePreview, readStructuredHouseholdMembers, readSubmittedPregnancyWeekDetails } from "@/lib/householdMembers";
import type { StructuredHouseholdMember } from "@/types/householdMembers";
import type { VerificationApplication } from "@/types/verification";
import styles from "./ReviewModal.module.css";

interface ReviewModalProps {
  isOpen: boolean;
  application: VerificationApplication | null;
  reviewNotes: string;
  onReviewNotesChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}

export function ReviewModal({
  isOpen,
  application,
  reviewNotes,
  onReviewNotesChange,
  onApprove,
  onReject,
  onClose,
}: ReviewModalProps) {
  const raw = application?.raw ?? {};
  const status = application?.status ?? "pending";
  const isPending = status === "pending";
  const reviewedAt = String(raw.reviewed_at ?? "");
  const reviewedBy = String(raw.reviewed_by ?? "");
  const savedReviewNotes = String(raw.admin_review_notes ?? "");
  const structuredHouseholdMembers = readStructuredHouseholdMembers(raw.household_members);
  const title = isPending
    ? "Review Resident Application"
    : status === "approved"
      ? "Approved Resident Application"
      : "Rejected Resident Application";

  return (
    <Modal className={styles.modal} backdropClassName={styles.backdrop} size="xl" isOpen={isOpen} onClose={onClose} labelledBy="review-title">
      <header className={styles.header}>
        <h2 id="review-title" className="srOnly">{title}</h2>
        <button className={styles.close} type="button" aria-label="Close review" onClick={onClose}>×</button>
      </header>
      <div className={styles.body}>
        <ReviewSection title="Personal Information" className={styles.personal} fields={[
          ["Last Name", String(raw.last_name ?? "")], ["First Name", String(raw.first_name ?? "")], ["Middle Name", String(raw.middle_name ?? "N/A")],
          ["Age", String(raw.age ?? "Not provided")], ["Sex", String(raw.sex ?? "Not provided")],
          ["Contact Number", String(raw.contact_number ?? application?.phone ?? "")], ["Occupation", String(raw.occupation ?? "N/A")],
          ["Family Head", raw.is_family_head == null ? "Not provided" : raw.is_family_head ? "Yes" : "No"],
        ]} />
        <ReviewSection title="Location Information" className={styles.location} fields={[
          ["Complete Address", String(raw.complete_address ?? application?.address ?? "")], ["Barangay", application?.barangay ?? ""],
        ]} />
        <ReviewSection title="Family & Household Information" className={styles.householdDetails} fields={[
          ["Total Family Members", String(raw.total_family_members ?? application?.familyMembers ?? "")],
          ["Infant Count", String(raw.infant_count ?? "Not provided")],
          ["Toddler Count", String(raw.toddler_count ?? "Not provided")],
          ["Elderly Count", String(raw.elderly_count ?? "Not provided")],
          ["PWD Count", String(raw.pwd_count ?? "Not provided")],
          ["Pregnant Count", String(raw.pregnant_count ?? "Not provided")],
          ["Lactating Count", String(raw.lactating_count ?? "Not provided")],
          ["4Ps Count", String(raw.four_ps_count ?? "Not provided")],
          ["Special Needs", String(raw.special_needs ?? "N/A")],
        ]} />
        <LegacyApplicationMemberDetails raw={raw} />
        {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && structuredHouseholdMembers.length > 0 ? <StructuredHouseholdMembersSection members={structuredHouseholdMembers} /> : null}
        <ReviewSection title="Submission Details" className={styles.submission} readout fields={[
          ["Date Submitted", application?.submitted ?? ""], ["Submitted By", String(raw.source ?? "Not provided")],
        ]} />
        {!isPending ? <>
          <ReviewSection title="Review Details" className={styles.submission} readout fields={[
            ["Status", capitalize(status)], ["Reviewed At", reviewedAt || "N/A"], ["Reviewed By", reviewedBy || "N/A"],
          ]} />
          <label className={styles.notes}><span>Admin Review Notes</span><textarea readOnly value={savedReviewNotes || "N/A"} /></label>
        </> : null}
        {isPending ? <label className={styles.notes}>
          <span>Admin Review Notes</span>
          <textarea
            placeholder="Enter feedback or remarks..."
            value={reviewNotes}
            onChange={(event) => onReviewNotesChange(event.target.value)}
          />
        </label> : null}
        <footer className={styles.actions}>
          {isPending ? (
            <>
              <Button tone="danger" onClick={onReject}>⊗ Reject Application</Button>
              <Button tone="success" onClick={onApprove}>✓ Approve Application</Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </footer>
      </div>
    </Modal>
  );
}

interface ReviewSectionProps {
  title: string;
  fields: Array<[string, string]>;
  className: string;
  readout?: boolean;
}

function ReviewSection({ title, fields, className, readout = false }: ReviewSectionProps) {
  return <section className={`${styles.section} ${className}`}>
    <h3>{title}</h3>
    <div>{fields.map(([label, value]) => <div key={label} className={readout ? styles.readout : styles.field}>
      <span>{label}</span>{readout ? <b>{formatBarangayName(value)}</b> : <output>{formatBarangayName(value)}</output>}
    </div>)}</div>
  </section>;
}

interface StructuredHouseholdMembersSectionProps {
  members: StructuredHouseholdMember[];
}

function StructuredHouseholdMembersSection({ members }: StructuredHouseholdMembersSectionProps) {
  return <section className={`${styles.section} ${styles.membersSection}`}>
    <div className={styles.membersHeader}>
      <div>
        <h3>Structured Household Members</h3>
        <p className={styles.membersIntro}>Structured members supplied by the application are shown below.</p>
      </div>
    </div>
    <div className={styles.memberList}>
      {members.map((member) => {
        const preview = getHouseholdMemberAgePreview(member.birth_date);
        return <article className={styles.memberCard} key={member.member_id}>
          <div className={styles.memberCardHeader}>
            <div>
              <strong>{member.full_name}</strong>
              <span className={styles.memberId}>Member ID: {member.member_id}</span>
            </div>
          </div>
          <div className={styles.memberFields}>
            <div className={styles.memberReadout}><span>Full Name</span><b>{member.full_name}</b></div>
            <div className={styles.memberReadout}><span>Birth Date</span><b>{member.birth_date ?? "Not provided"}</b></div>
          </div>
          <div className={styles.memberMeta}>
            <span>Current Age: <b>{preview.ageLabel ?? "Unavailable"}</b></span>
            <span>Classification: <b>{preview.ageLabel ? preview.classification : "Unavailable"}</b></span>
            <span>PWD: <b>{member.is_pwd ? "Yes" : "No"}</b></span>
            <span>Pregnant: <b>{member.is_pregnant ? "Yes" : "No"}</b></span>
            {member.is_pregnant ? <>
              <span>Pregnancy Baseline: <b>{member.pregnancy_weeks ?? "Not provided"} weeks</b></span>
              <span>Current Pregnancy Weeks: <b>{member.current_pregnancy_weeks ?? "Unavailable"}</b></span>
              <span>Pregnancy Recorded: <b>{formatPregnancyDate(member.pregnancy_baseline_at)}</b></span>
            </> : null}
            <span>Lactating: <b>{member.is_lactating ? "Yes" : "No"}</b></span>
            <span>4Ps: <b>{member.is_4ps ? "Yes" : "No"}</b></span>
            {member.resident_id ? <span>Resident Link: <b>{member.resident_id}</b></span> : null}
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function LegacyApplicationMemberDetails({ raw }: { raw: Record<string, unknown> }) {
  const pregnancyWeekDetails = readSubmittedPregnancyWeekDetails(raw.legacy_pregnancy_week_details);
  const groups = [
    { label: "Infant", names: readStringArray(raw.infant_full_names), birthDates: readStringArray(raw.infant_birth_dates), pregnancyDetails: [] },
    { label: "Toddler", names: readStringArray(raw.toddler_full_names), birthDates: readStringArray(raw.toddler_birth_dates), pregnancyDetails: [] },
    { label: "Elderly", names: readStringArray(raw.elderly_full_names), birthDates: readStringArray(raw.elderly_birth_dates), pregnancyDetails: [] },
    { label: "PWD", names: readStringArray(raw.pwd_full_names), birthDates: [], pregnancyDetails: [] },
    { label: "Pregnant", names: readStringArray(raw.pregnant_full_names), birthDates: [], pregnancyDetails: pregnancyWeekDetails },
    { label: "Lactating", names: readStringArray(raw.lactating_full_names), birthDates: [], pregnancyDetails: [] },
    { label: "4Ps", names: readStringArray(raw.four_ps_full_names), birthDates: [], pregnancyDetails: [] },
  ].filter((group) => group.names.length > 0 || group.birthDates.length > 0 || group.pregnancyDetails.length > 0);

  if (groups.length === 0) return null;

  return <section className={`${styles.section} ${styles.legacyMembers}`}>
    <h3>Submitted Member Details</h3>
    <p className={styles.legacyIntro}>
      Legacy application names, birth dates, and pregnancy weeks are displayed as separate submitted lists. They are not paired or converted into structured member identities.
    </p>
    <div className={styles.legacyGroups}>
      {groups.map((group) => <div className={styles.legacyGroup} key={group.label}>
        <h4>{group.label}</h4>
        <div className={styles.legacyColumns}>
          {group.names.length > 0 ? <div><span>Names submitted</span><ul>{group.names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></div> : null}
          {group.birthDates.length > 0 ? <div><span>Birth dates submitted</span><ul>{group.birthDates.map((date, index) => {
            const preview = getHouseholdMemberAgePreview(date);
            return <li key={`${date}-${index}`}>
              <span className={styles.submittedDate}>{date}</span>
              <span className={styles.submittedAge}>Age: {preview.ageLabel ?? "Unavailable"}</span>
              <span className={styles.submittedAge}>Classification: {preview.ageLabel ? preview.classification : "Unavailable"}</span>
            </li>;
          })}</ul></div> : null}
          {group.pregnancyDetails.length > 0 ? <div>
            <span>Pregnancy weeks submitted</span>
            <ul>{group.pregnancyDetails.map((detail, index) => <li key={`pregnancy-week-${index}`}>
              <span className={styles.submittedDate}>Baseline: {formatSubmittedWeeks(detail.pregnancy_weeks)}</span>
              <span className={styles.submittedAge}>Current: {detail.current_pregnancy_weeks == null ? "Unavailable" : `${detail.current_pregnancy_weeks} weeks`}</span>
              <span className={styles.submittedAge}>Registered: {formatPregnancyDate(detail.pregnancy_baseline_at)}</span>
            </li>)}</ul>
          </div> : null}
        </div>
      </div>)}
    </div>
  </section>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSubmittedWeeks(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? `${Number(value)} weeks` : "Invalid or unavailable";
}

function formatPregnancyDate(value: string | null | undefined) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}
