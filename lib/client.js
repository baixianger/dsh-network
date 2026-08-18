window.__ModuleLoader__.load({
  id: "dsh-network",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    function isIOSBrowser() {
      if (typeof navigator === "undefined") return false;
      return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function AppBanner() {
      const [visible, setVisible] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        if (!isIOSBrowser() || localStorage.getItem("dsh-network.app-banner.dismissed") === "1") return;
        let active = true;
        fetch("/dsh-network/info", { credentials: "same-origin", cache: "no-store" })
          .then((response) => { if (active && response.ok) setVisible(true); })
          .catch(() => {});
        return () => { active = false; };
      }, []);

      if (!visible) return null;
      const dismiss = () => {
        localStorage.setItem("dsh-network.app-banner.dismissed", "1");
        setVisible(false);
      };
      const openApp = async () => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/dsh-network/handoff/ios", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ origin: location.origin })
          });
          const value = await response.json();
          if (!response.ok || !value.url) throw new Error("handoff_failed");
          location.href = value.url;
        } catch {
          setError("Open DSH from a newly generated pairing QR.");
          setBusy(false);
        }
      };

      return h("aside", {
        role: "region",
        "aria-label": "Open in DSH app",
        style: {
          position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 2147483000, pointerEvents: "auto",
          boxSizing: "border-box", width: "min(420px, calc(100vw - 24px))", minHeight: 62,
          display: "flex", alignItems: "center", gap: 11, padding: "9px 10px",
          border: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2, #d8dbe2) 78%, transparent)",
          borderRadius: 16, background: "color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 94%, transparent)",
          color: "var(--dsw-alias-label-primary, #18191c)", boxShadow: "0 10px 36px rgba(15, 23, 42, .14)",
          WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
        }
      },
        h("img", { src: "/dsh-network/app-icon.png", alt: "", width: 44, height: 44, style: { flex: "0 0 44px", borderRadius: 10 } }),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("strong", { style: { display: "block", fontSize: 14, lineHeight: "18px", fontWeight: 650 } }, "DSH"),
          h("span", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, lineHeight: "17px", color: error ? "#b42318" : "var(--dsw-alias-label-secondary, #666b74)" } }, error || "Continue on this Server in the app")
        ),
        h("button", { type: "button", onClick: openApp, disabled: busy, style: { border: 0, borderRadius: 15, minWidth: 58, height: 32, padding: "0 13px", background: "var(--dsw-alias-state-business-primary, #3568f0)", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 650 } }, busy ? "…" : "Open"),
        h("button", { type: "button", onClick: dismiss, "aria-label": "Dismiss", style: { border: 0, width: 28, height: 32, padding: 0, background: "transparent", color: "var(--dsw-alias-label-tertiary, #8a8f98)", fontSize: 20 } }, "×")
      );
    }

    function apply(ctx) {
      ctx.slots.inject("shell.overlay", () => ctx.slots.register(
        { name: "shell.overlay", id: "dsh-network-app-banner", order: 100, label: "Open in DSH app" },
        AppBanner
      ));
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
