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
      const [mode, setMode] = React.useState("open");
      const [downloadURL, setDownloadURL] = React.useState("");

      React.useEffect(() => {
        let active = true;
        const showDownload = async () => {
          try {
            const response = await fetch("/dsh-network/ui-config", { credentials: "same-origin", cache: "no-store" });
            const config = response.ok ? await response.json() : null;
            if (!active || !config?.iosAppDownloadURL) return;
            const shownKey = `dsh-network.ios-download.shown:${config.iosAppDownloadURL}`;
            if (localStorage.getItem(shownKey) === "1") return;
            localStorage.setItem(shownKey, "1");
            setDownloadURL(config.iosAppDownloadURL);
            setMode("download");
            setVisible(true);
          } catch {}
        };
        if (isIOSBrowser()) {
          if (localStorage.getItem("dsh-network.app-banner.dismissed") === "1") return;
          fetch("/dsh-network/info", { credentials: "same-origin", cache: "no-store" })
            .then((response) => {
              if (active && response.ok) setVisible(true);
              else return showDownload();
            })
            .catch(showDownload);
        } else {
          void showDownload();
        }
        return () => { active = false; };
      }, []);

      if (!visible) return null;
      const dismiss = () => {
        if (mode === "open") localStorage.setItem("dsh-network.app-banner.dismissed", "1");
        setVisible(false);
      };
      const performAction = async () => {
        if (busy) return;
        if (mode === "download") {
          window.open(downloadURL, "_blank", "noopener,noreferrer");
          setVisible(false);
          return;
        }
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
          h("strong", { style: { display: "block", fontSize: 14, lineHeight: "18px", fontWeight: 650 } }, mode === "download" ? "DSH for iOS" : "DSH"),
          h("span", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, lineHeight: "17px", color: error ? "#b42318" : "var(--dsw-alias-label-secondary, #666b74)" } }, error || (mode === "download" ? "Continue your sessions from iPhone or iPad" : "Continue on this Host in the app"))
        ),
        h("button", { type: "button", onClick: performAction, disabled: busy, style: { border: 0, borderRadius: 15, minWidth: 58, height: 32, padding: "0 13px", background: "var(--dsw-alias-state-business-primary, #3568f0)", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 650 } }, busy ? "…" : (mode === "download" ? "Download" : "Open")),
        h("button", { type: "button", onClick: dismiss, "aria-label": "Dismiss", style: { border: 0, width: 28, height: 32, padding: 0, background: "transparent", color: "var(--dsw-alias-label-tertiary, #8a8f98)", fontSize: 20 } }, "×")
      );
    }

    function NetworkSettings() {
      const [status, setStatus] = React.useState(null);
      const [url, setUrl] = React.useState("");
      const [qr, setQr] = React.useState(null);
      const [error, setError] = React.useState("");
      const [working, setWorking] = React.useState(false);

      const refresh = React.useCallback(async () => {
        try {
          const response = await fetch("/dsh-network/status", { credentials: "same-origin", cache: "no-store" });
          if (!response.ok) throw new Error("network status unavailable");
          setStatus(await response.json());
        } catch (cause) {
          setStatus(null);
          setError(String(cause?.message ?? cause));
        }
      }, []);

      React.useEffect(() => { void refresh(); }, [refresh]);

      const generate = async () => {
        if (working) return;
        setWorking(true);
        setError("");
        setQr(null);
        try {
          const query = url.trim() ? `?url=${encodeURIComponent(url.trim())}` : "";
          const response = await fetch(`/dsh-network/pairing/qr${query}`, { credentials: "same-origin", cache: "no-store" });
          const value = await response.json();
          if (!response.ok) throw new Error(value?.error ?? "pairing_qr_failed");
          setQr(value);
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        } finally {
          setWorking(false);
        }
      };

      const field = { boxSizing: "border-box", minHeight: 38, border: "1px solid var(--dsw-alias-border-l2, #ddd)", borderRadius: 9, padding: "0 11px", background: "var(--dsw-alias-bg-layer-1, #fff)", color: "inherit" };
      const button = { ...field, cursor: "pointer" };
      const expires = qr ? new Date(qr.expiresAt).toLocaleTimeString() : "";
      return h("div", { style: { width: "min(720px, 100%)", padding: "8px 4px 48px" } },
        h("div", { style: { marginBottom: 26 } },
          h("h2", { style: { margin: "0 0 6px", fontSize: 22 } }, "Network"),
          h("p", { style: { margin: 0, color: "var(--dsw-alias-text-secondary, #777)", lineHeight: 1.5 } }, "Pair the DSH iOS app or another device with this Host. The gateway also serves LAN, Tailnet, and public HTTPS routes.")),
        error && h("p", { role: "alert", style: { padding: 10, borderRadius: 9, background: "rgba(210,48,48,.08)", color: "var(--dsw-alias-state-error-primary, #b42318)" } }, error),
        h("section", { style: { marginBottom: 28 } },
          h("h3", { style: { margin: "0 0 6px", fontSize: 15 } }, "Host"),
          status ? h("div", { style: { display: "grid", gap: 8 } },
            h("div", { style: { padding: "12px 14px", borderRadius: 10, background: "var(--dsw-alias-bg-layer-2, #f6f7f8)" } },
              h("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" } },
                h("strong", null, status.name || "DSH Host"),
                h("span", { style: { color: "#228b5b", fontSize: 13 } }, "Gateway online")),
              h("div", { style: { color: "var(--dsw-alias-text-secondary, #777)", fontSize: 12, marginTop: 4, wordBreak: "break-all" } },
                `hostId ${status.hostId}`),
              h("div", { style: { color: "var(--dsw-alias-text-secondary, #777)", fontSize: 12, marginTop: 4 } },
                `Gateway ${status.bindHost}:${status.gatewayPort} · ${status.pairedDevices} paired device${status.pairedDevices === 1 ? "" : "s"}`),
              status.lanUrl && h("div", { style: { color: "var(--dsw-alias-text-secondary, #777)", fontSize: 12, marginTop: 4, wordBreak: "break-all" } }, `LAN ${status.lanUrl}`)))
            : h("p", { style: { color: "var(--dsw-alias-text-secondary, #777)", fontSize: 13 } }, "Gateway status unavailable.")),
        h("section", { style: { marginBottom: 28 } },
          h("h3", { style: { margin: "0 0 8px", fontSize: 15 } }, "Pair a device"),
          h("p", { style: { margin: "0 0 10px", color: "var(--dsw-alias-text-secondary, #777)", fontSize: 13, lineHeight: 1.5 } }, "Scan the QR with the DSH iOS app, or open the link in a browser on the same network. Leave the address empty to auto-detect the LAN URL."),
          h("form", { onSubmit: (event) => { event.preventDefault(); void generate(); }, style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            h("input", { value: url, onChange: (event) => setUrl(event.target.value), placeholder: status?.lanUrl || "https://dsh.example.com", spellCheck: false, style: { ...field, flex: "1 1 260px" } }),
            h("button", { type: "submit", disabled: working, style: button }, working ? "…" : "Generate QR")),
          qr && h("div", { style: { marginTop: 14, display: "grid", gap: 10, justifyItems: "start" } },
            h("img", { src: qr.qr, alt: "Pairing QR code", width: 240, height: 240, style: { borderRadius: 12, border: "1px solid var(--dsw-alias-border-l2, #ddd)" } }),
            h("div", { style: { color: "var(--dsw-alias-text-secondary, #777)", fontSize: 12, lineHeight: 1.5 } },
              h("div", { style: { wordBreak: "break-all" } }, qr.url),
              h("div", { style: { marginTop: 2 } }, `Pairing ticket expires at ${expires}. Generate again for a new ticket.`)))))
    }

    function apply(ctx) {
      ctx.slots.inject("shell.overlay", () => ctx.slots.register(
        { name: "shell.overlay", id: "dsh-network-app-banner", order: 100, label: "Open in DSH app" },
        AppBanner
      ));
      ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "network", order: 40, label: () => "Network" },
        NetworkSettings
      ));
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
