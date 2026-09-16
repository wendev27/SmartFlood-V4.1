import { Modal } from "@/components/ui/Modal/Modal";
import { Button } from "@/components/ui/Button/Button";
import { formatBarangayName } from "@/lib/formatters";
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

export function ReviewModal({ isOpen, application, reviewNotes, onReviewNotesChange, onApprove, onReject, onClose }: ReviewModalProps) {
  const raw = application?.raw ?? {};
  const status = application?.status ?? "pending";
  const isPending = status === "pending";
  const reviewedAt = String(raw.reviewed_at ?? "");
  const reviewedBy = String(raw.reviewed_by ?? "");
  const savedReviewNotes = String(raw.admin_review_notes ?? "");
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
          ["Special Needs", String(raw.special_needs ?? "N/A")], ["Medical Conditions", String(raw.medical_conditions ?? "N/A")],
        ]} />
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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
