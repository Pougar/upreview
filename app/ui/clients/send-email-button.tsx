"use client";

import { useState } from "react";

export default function SendEmailButton({
  clientId,
  disabled = false,
  onSent,
}: {
  clientId: string;
  disabled?: boolean;           // disable when email already sent
  onSent?: () => void;          // called after successful send
}) {
  const [sending, setSending] = useState(false);
  const isDisabled = disabled || sending;

  const handleSend = async () => {
    if (isDisabled) return;
    setSending(true);
    try {
      const res = await fetch("/api/send-review-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
      // optional: await res.json();
      onSent?.();               // refresh table without full page reload
    } catch (e) {
      console.error(e);
      // optional: toast error
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSend}
      disabled={isDisabled}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
        isDisabled
          ? "cursor-not-allowed bg-gray-100 text-gray-400 ring-gray-200"
          : "bg-blue-600 text-white ring-blue-300 hover:bg-blue-700"
      }`}
      aria-disabled={isDisabled}
      aria-label={disabled ? "Email already sent" : "Send review request email"}
      title={disabled ? "Email already sent" : "Send review request email"}
    >
      {sending ? "Sending…" : disabled ? "Sent" : "Send Email"}
    </button>
  );
}
