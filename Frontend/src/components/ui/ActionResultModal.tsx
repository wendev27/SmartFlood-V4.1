"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button/Button";
import { Modal } from "@/components/ui/Modal/Modal";
import { cn } from "@/lib/cn";
import styles from "./ActionResultModal.module.css";

export type ActionResultType = "success" | "error" | "warning" | "info";

interface ActionResultModalProps {
  open: boolean;
  type: ActionResultType;
  title: string;
  description: string;
  details?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onClose: () => void;
  variant?: "default" | "cswdd";
  children?: ReactNode;
}

const iconPath: Record<ActionResultType, string> = {
  success: "M7.5 12.4 10.3 15.2 16.8 8.8",
  error: "M12 3.5 5.5 6.1v5.1c0 4 2.7 7.7 6.5 8.8 3.8-1.1 6.5-4.8 6.5-8.8V6.1L12 3.5Zm0 4.5v5",
  warning: "M12 7.8v5.3m0 3.2h.01",
  info: "M12 10.5v5.8m0-8.7h.01",
};

export function ActionResultModal({
  open,
  type,
  title,
  description,
  details,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onClose,
  variant = "default",
  children,
}: ActionResultModalProps) {
  const labelledBy = `action-result-${type}-title`;
  const showActions = Boolean(primaryLabel || secondaryLabel);

  function handlePrimary() {
    onPrimary?.();
    if (!onPrimary) onClose();
  }

  function handleSecondary() {
    onSecondary?.();
    if (!onSecondary) onClose();
  }

  return (
    <Modal isOpen={open} onClose={onClose} labelledBy={labelledBy} className={cn(styles.dialog, variant === "cswdd" && styles.cswddDialog)} backdropClassName={variant === "cswdd" ? styles.cswddBackdrop : undefined}>
      <div className={cn(styles.card, styles[type], variant === "cswdd" && styles.cswddCard)}>
        <span className={styles.iconWrap} aria-hidden="true">
          <svg viewBox="0 0 24 24" className={styles.icon}>
            {type === "error" ? (
              <>
                <path d={iconPath.error} />
                <path d="M12 16.9h.01" />
              </>
            ) : type === "warning" ? (
              <>
                <path d="M10.2 4.4 2.8 17.2a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.8 4.4a2 2 0 0 0-3.6 0Z" />
                <path d={iconPath.warning} />
              </>
            ) : type === "info" ? (
              <>
                <circle cx="12" cy="12" r="8.5" />
                <path d={iconPath.info} />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="8.5" />
                <path d={iconPath.success} />
              </>
            )}
          </svg>
        </span>

        <h2 id={labelledBy}>{title}</h2>
        <p className={styles.description}>{description}</p>

        {details ? <div className={styles.details}>{details}</div> : null}

        {children}

        {showActions ? (
          <div className={styles.actions}>
            {primaryLabel ? (
              <Button className={styles.primaryButton} tone={type === "error" ? "danger" : type === "success" ? "success" : "primary"} onClick={handlePrimary}>
                {primaryLabel}
              </Button>
            ) : null}
            {secondaryLabel ? (
              <button className={styles.secondaryButton} type="button" onClick={handleSecondary}>
                {secondaryLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
