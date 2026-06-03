"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!CriOS|FxiOS|EdgiOS).)*Safari/.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && Boolean(window.navigator.standalone))
  );
}

export function InstallHelp() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisible(isIosSafari() && !isStandalone() && window.localStorage.getItem("install-help-dismissed") !== "1");
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!visible) return null;

  return (
    <aside className="safe-x pt-3">
      <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-brand-soft px-3.5 py-3 text-sm text-brand-strong">
        <Share aria-hidden="true" size={18} className="shrink-0" />
        <p className="leading-5">
          Install on iPhone — tap <span className="font-semibold">Share</span>, then{" "}
          <span className="font-semibold">Add to Home Screen</span>.
        </p>
        <button
          type="button"
          className="touch-target -my-2 -mr-1 ml-auto flex shrink-0 items-center justify-center rounded-full px-1 text-brand-strong/70 transition-colors hover:text-brand-strong"
          aria-label="Dismiss install help"
          onClick={() => {
            window.localStorage.setItem("install-help-dismissed", "1");
            setVisible(false);
          }}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
    </aside>
  );
}
