import { useEffect, useRef, useState } from "react";

interface CredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      shape: "pill";
      text: "continue_with";
      width: number;
    },
  ): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

let scriptPromise: Promise<void> | undefined;
function loadGoogleIdentity() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const script = existing ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Google sign-in could not be loaded.")),
      { once: true },
    );
    if (!existing) document.head.append(script);
  });
  return scriptPromise;
}

export function disableGoogleAutoSelect() {
  window.google?.accounts.id.disableAutoSelect();
}

export default function GoogleSignIn({
  clientId,
  busy,
  onCredential,
}: {
  clientId: string;
  busy: boolean;
  onCredential: (credential: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const credentialHandler = useRef(onCredential);
  const [error, setError] = useState("");
  credentialHandler.current = onCredential;

  useEffect(() => {
    let active = true;
    void loadGoogleIdentity()
      .then(() => {
        if (!active || !container.current || !window.google) return;
        container.current.replaceChildren();
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) =>
            credentialHandler.current(response.credential),
        });
        window.google.accounts.id.renderButton(container.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: Math.max(
            200,
            Math.min(320, Math.floor(container.current.clientWidth)),
          ),
        });
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  return (
    <div className={`google-sign-in ${busy ? "busy" : ""}`}>
      <div ref={container} aria-hidden={busy || undefined} />
      {busy && <span className="google-sign-in-busy">Connecting…</span>}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
