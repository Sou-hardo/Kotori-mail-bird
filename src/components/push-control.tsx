"use client";
import { useState } from "react";
const decode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
export function PushControl({ publicKey }: { publicKey: string }) {
  const [status, setStatus] = useState("");
  async function enable() {
    if (!("serviceWorker" in navigator) || !publicKey) {
      setStatus("Push is not configured");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Permission not granted");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decode(publicKey),
    });
    await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub),
    });
    setStatus("Push enabled");
  }
  return (
    <div>
      <button onClick={enable}>Enable push</button>
      {status && <small role="status">{status}</small>}
    </div>
  );
}
