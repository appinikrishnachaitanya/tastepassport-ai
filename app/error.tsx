"use client";

export default function ErrorRecovery({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page-recovery">
    <p className="micro-label">TASTEPASSPORT</p>
    <h1>Your Passport hit a display problem.</h1>
    <p>We couldn't display the latest update. Try restoring your last successfully displayed Passport in this browser tab.</p>
    <button onClick={reset}>Restore my Passport view</button>
    <p><a href="/">Start a new Passport</a></p>
    <p className="helper">We’ll restore your last discoveries and try to reconnect automatically. If you need a fresh Passport, you can reuse your tastes. Your saved account Passports stay in your account.</p>
  </main>;
}
