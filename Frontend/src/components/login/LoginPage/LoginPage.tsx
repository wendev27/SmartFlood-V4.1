"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/services/apiClient";
import { clearStoredSession, getCurrentUser, setStoredSession, type StoredSessionUser } from "@/lib/authSession";
import styles from "./LoginPage.module.css";

function UserIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="3" /><path d="M4.75 16a5.25 5.25 0 0 1 10.5 0" /></svg>;
}

function PasswordIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.83 8.97V5.63A4.17 4.17 0 0 1 10 1.47a4.17 4.17 0 0 1 4.17 4.16v3.34" /><rect x="2.5" y="8.97" width="15" height="9.17" rx="1.67" /></svg>;
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M1.72 10.29a.84.84 0 0 1 0-.58A8.95 8.95 0 0 1 10 4.17a8.95 8.95 0 0 1 8.28 5.54.84.84 0 0 1 0 .58A8.95 8.95 0 0 1 10 15.83a8.95 8.95 0 0 1-8.28-5.54Z" />
      <circle cx="10" cy="10" r="2.5" />
      {crossed ? <path d="M3 3l14 14" /> : null}
    </svg>
  );
}

function LoginErrorIcon() {
  return (
    <svg className={styles.errorIcon} viewBox="0 0 44 44" aria-hidden="true">
      <path d="M27.32 3.67H16.68c-1.25 0-3.01.73-3.89 1.61L5.28 12.8c-.88.88-1.61 2.64-1.61 3.88v10.64c0 1.25.73 3.01 1.61 3.89l7.52 7.51c.88.88 2.64 1.61 3.88 1.61h10.64c1.25 0 3.01-.73 3.89-1.61l7.51-7.52c.88-.88 1.61-2.64 1.61-3.88V16.68c0-1.25-.73-3.01-1.61-3.89L31.2 5.28c-.88-.88-2.64-1.61-3.88-1.61Z" />
      <path d="m15.58 28.42 12.84-12.84M28.42 28.42 15.58 15.58" opacity=".45" />
    </svg>
  );
}

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    if (getCurrentUser()) {
      router.replace("/dashboard");
      return;
    }
    setSessionChecked(true);
  }, [router]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await fetchJson<StoredSessionUser>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      clearStoredSession();
      setStoredSession(user);
      router.push("/dashboard");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to login. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!sessionChecked) return null;

  return (
    <main className={styles.page}>
      <div className={styles.wordmark}>Smart<span>Flood</span></div>

      <section className={styles.formPanel} aria-label="Login">
        <div className={styles.loginCard}>
          {error ? (
            <div className={styles.errorMessage} role="alert">
              <LoginErrorIcon />
              <div><strong>Login Failed</strong><p>{error}</p></div>
            </div>
          ) : null}

          <div className={styles.heading}>
            <div className={styles.mobileWordmark}>Smart<span>Flood</span></div>
            <h1>Welcome back!</h1>
            <p>Sign in to continue to <span>SmartFlood</span></p>
          </div>

          <form className={styles.loginForm} onSubmit={submitLogin}>
            <label className={styles.fieldGroup} htmlFor="email">
              <span>Username</span>
              <span className={styles.inputShell}>
                <UserIcon />
                <input id="email" aria-label="Email" autoComplete="email" placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </span>
            </label>

            <label className={styles.fieldGroup} htmlFor="password">
              <span>Password</span>
              <span className={styles.inputShell}>
                <PasswordIcon />
                <input id="password" autoComplete="current-password" placeholder="Enter password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} />
                <button className={styles.iconButton} type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
                  <EyeIcon crossed={showPassword} />
                </button>
              </span>
            </label>

            <button className={styles.loginButton} type="submit" disabled={isSubmitting}>{isSubmitting ? "Logging in..." : "Login"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
