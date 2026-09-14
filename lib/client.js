window.__ModuleLoader__.load({
  id: "dsh-network",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    const NS = "dsh-network";
    const dictionaries = {
  "zh": {
    "title": "Network",
    "intro": "连接 DSH iOS App 或其他设备，支持局域网、Tailnet 和公网 HTTPS 访问。",
    "host": "当前主机",
    "hostId": "主机标识",
    "gateway": "网关",
    "gatewayOnline": "网关在线",
    "pairedDevices": "台已配对设备",
    "lan": "局域网地址",
    "statusUnavailable": "暂时无法读取网关状态",
    "loading": "读取中…",
    "working": "处理中…",
    "refresh": "刷新",
    "pairDevice": "配对设备",
    "pairHint": "使用 DSH iOS App 扫码，或在同一网络的浏览器中打开链接。地址留空时自动使用局域网地址。",
    "address": "访问地址（可选）",
    "generate": "生成配对码",
    "qrAlt": "设备配对二维码",
    "qrFailed": "无法生成配对二维码",
    "expires": "配对凭据到期时间：",
    "regenerate": "需要新的凭据时，请重新生成。",
    "bannerLabel": "在 DSH App 中打开",
    "openFailed": "请使用新生成的配对二维码打开 DSH。",
    "downloadHint": "在 iPhone 或 iPad 上继续会话",
    "openHint": "在 App 中连接此主机",
    "download": "下载",
    "open": "打开",
    "dismiss": "关闭提示"
  },
  "en": {
    "title": "Network",
    "intro": "Connect the DSH iOS app or another device over LAN, Tailnet or public HTTPS.",
    "host": "This host",
    "hostId": "Host ID",
    "gateway": "Gateway",
    "gatewayOnline": "Gateway online",
    "pairedDevices": "paired devices",
    "lan": "LAN address",
    "statusUnavailable": "Gateway status unavailable",
    "loading": "Loading…",
    "working": "Working…",
    "refresh": "Refresh",
    "pairDevice": "Pair a device",
    "pairHint": "Scan with the DSH iOS app or open the link in a browser on the same network. Leave the address empty to use the detected LAN address.",
    "address": "Access address (optional)",
    "generate": "Generate pairing QR",
    "qrAlt": "Device pairing QR code",
    "qrFailed": "Could not generate the pairing QR",
    "expires": "Pairing ticket expires at",
    "regenerate": "Generate again for a new ticket.",
    "bannerLabel": "Open in DSH App",
    "openFailed": "Open DSH using a newly generated pairing QR.",
    "downloadHint": "Continue on iPhone or iPad",
    "openHint": "Continue on this host in the app",
    "download": "Download",
    "open": "Open",
    "dismiss": "Dismiss banner"
  }
};
    const styles = `.dshNetworkSettings { display:flex; flex-direction:column; gap:18px; max-width:720px; min-width:0; padding-bottom:24px; font-size:14px; line-height:22px; color:var(--dsw-alias-label-primary); }
.dshNetworkSettings * { box-sizing:border-box; }
.dshNetworkSettings h2 { margin:0; font-size:20px; line-height:28px; font-weight:600; }
.dshNetworkSettings h3 { margin:0; font-size:14px; line-height:20px; font-weight:600; }
.dshNetworkSettings p { margin:0; color:var(--dsw-alias-label-secondary); }
.dshNetworkSettings header p { margin-top:6px; }
.dshNetworkSettings .panel { padding:18px 20px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-module-platform); display:flex; flex-direction:column; gap:14px; min-width:0; }
.dshNetworkSettings .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.dshNetworkSettings .between { justify-content:space-between; }
.dshNetworkSettings .grow { flex:1; min-width:0; overflow-wrap:anywhere; }
.dshNetworkSettings .muted { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
.dshNetworkSettings .field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--dsw-alias-label-secondary); min-width:0; }
.dshNetworkSettings :is(input,textarea,select) { min-width:0; max-width:100%; min-height:38px; padding:8px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px; }
.dshNetworkSettings textarea { width:100%; resize:vertical; }
.dshNetworkSettings input { width:100%; }
.dshNetworkSettings button { display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:6px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:18px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px; cursor:pointer; }
.dshNetworkSettings button.primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); border-color:var(--dsw-alias-button-primary-fill); }
.dshNetworkSettings button.danger { color:var(--dsw-alias-state-error-primary); }
.dshNetworkSettings button:not(:disabled):not(.primary):hover { background:var(--dsw-alias-interactive-bg-hover); }
.dshNetworkSettings button:disabled { opacity:.45; cursor:default; }
.dshNetworkSettings :is(button,input,textarea,select,a):focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.dshNetworkSettings .alert { padding:10px 12px; border-left:2px solid var(--dsw-alias-state-error-primary); border-radius:4px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-state-error-primary); overflow-wrap:anywhere; font-size:13px; }
.dshNetworkSettings .list { display:flex; flex-direction:column; gap:10px; }
.dshNetworkSettings .list-item { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); min-width:0; }
.dshNetworkSettings .name { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
.dshNetworkSettings .code { font-family:ui-monospace,monospace; font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.dshNetworkSettings .status { display:inline-flex; align-items:center; gap:6px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.dshNetworkSettings .status::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; flex:0 0 auto; }
.dshNetworkSettings .status[data-state="online"],.dshNetworkSettings .status[data-state="running"] { color:var(--dsw-alias-state-success-primary); }
.dshNetworkSettings .status[data-state="connecting"] { color:var(--dsw-alias-state-warn-primary); }
.dshNetworkSettings .status[data-state="unpaired"] { color:var(--dsw-alias-state-error-primary); }
.dshNetworkSettings .empty { padding:10px 0; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dshNetworkSettings .confirm { display:flex; flex-direction:column; gap:8px; padding-top:10px; border-top:1px solid var(--dsw-alias-border-l1); font-size:13px; }
`;
    function installStyles() {
      if (typeof document === "undefined") return;
      const style = document.createElement("style"); style.dataset.plugin = NS;
      style.textContent = styles; document.head.appendChild(style);
      return () => style.remove();
    }

    function isIOSBrowser() {
      if (typeof navigator === "undefined") return false;
      return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function AppBanner({ t }) {
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
          } catch {
            // Best-effort banner probe: a failed ui-config fetch or a storage
            // denial leaves the download banner hidden, and nothing else
            // consumes this request.
          }
        };
        if (isIOSBrowser()) {
          if (localStorage.getItem("dsh-network.app-banner.dismissed") === "1") return;
          // Best-effort info probe: any failure falls back to the download banner.
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
          setError(t("openFailed"));
          setBusy(false);
        }
      };

      return h("aside", {
        role: "region",
        "aria-label": t("bannerLabel"),
        style: {
          position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 2147483000, pointerEvents: "auto",
          boxSizing: "border-box", width: "min(420px, calc(100vw - 24px))", minHeight: 62,
          display: "flex", alignItems: "center", gap: 11, padding: "9px 10px",
          border: "1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 78%, transparent)",
          borderRadius: 16, background: "color-mix(in srgb, var(--dsw-alias-bg-layer-1) 94%, transparent)",
          color: "var(--dsw-alias-label-primary)", boxShadow: "var(--dsw-shadow-lv2)",
          WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
        }
      },
        h("img", { src: "/dsh-network/app-icon.png", alt: "", width: 44, height: 44, style: { flex: "0 0 44px", borderRadius: 10 } }),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("strong", { style: { display: "block", fontSize: 14, lineHeight: "18px", fontWeight: 500 } }, mode === "download" ? "DSH for iOS" : "DSH"),
          h("span", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, lineHeight: "17px", color: error ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)" } }, error || (mode === "download" ? t("downloadHint") : t("openHint")))
        ),
        h("button", { type: "button", onClick: performAction, disabled: busy, style: { border: 0, borderRadius: 15, minWidth: 58, height: 32, padding: "0 13px", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", font: "inherit", fontSize: 13, fontWeight: 500 } }, busy ? "…" : (mode === "download" ? t("download") : t("open"))),
        h("button", { type: "button", onClick: dismiss, "aria-label": t("dismiss"), style: { border: 0, width: 28, height: 32, padding: 0, background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 20 } }, "×")
      );
    }

    function NetworkSettings({ t, locale }) {
      const [status, setStatus] = React.useState(null);
      const [url, setUrl] = React.useState("");
      const [qr, setQr] = React.useState(null);
      const [error, setError] = React.useState("");
      const [working, setWorking] = React.useState(false);
      const lifecycle = React.useRef({ controller: new AbortController(), busy: false });
      const refresh = React.useCallback(async (signal = lifecycle.current.controller.signal) => {
        const response = await fetch("/dsh-network/status", { credentials: "same-origin", cache: "no-store", signal });
        if (!response.ok) throw new Error(`${t("statusUnavailable")} (HTTP ${response.status})`);
        const value = await response.json(); signal.throwIfAborted(); setStatus(value); setError("");
      }, []);
      React.useEffect(() => {
        const controller = new AbortController(); lifecycle.current.controller = controller;
        void refresh(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)); });
        return () => controller.abort();
      }, [refresh]);
      const run = async (action) => {
        if (lifecycle.current.busy) return;
        const signal = lifecycle.current.controller.signal;
        lifecycle.current.busy = true; setWorking(true); setError("");
        try { await action(signal); }
        catch (cause) { if (!signal.aborted) setError(String(cause.message ?? cause)); }
        finally { lifecycle.current.busy = false; if (!signal.aborted) setWorking(false); }
      };
      const generate = () => run(async (signal) => {
        setQr(null);
        const query = url.trim() ? `?url=${encodeURIComponent(url.trim())}` : "";
        const response = await fetch(`/dsh-network/pairing/qr${query}`, { credentials: "same-origin", cache: "no-store", signal });
        const value = await response.json(); signal.throwIfAborted();
        if (!response.ok) throw new Error(value?.error ?? t("qrFailed"));
        setQr(value);
      });
      const expires = qr ? new Date(qr.expiresAt).toLocaleTimeString(locale.getLocale?.().active ?? undefined) : "";
      return h("section", { className: "dshNetworkSettings", "aria-label": t("title") },
        h("header", null, h("h2", null, t("title")), h("p", null, t("intro"))),
        error ? h("p", { role: "alert", className: "alert" }, error) : null,
        h("section", { className: "panel" },
          h("div", { className: "row between" }, h("h3", null, t("host")), h("button", { type: "button", onClick: () => run(refresh), disabled: working }, working ? t("working") : t("refresh"))),
          status ? h("div", { className: "list-item" },
            h("div", { className: "row between" }, h("strong", { className: "name grow" }, status.name || "DSH Host"), h("span", { className: "status", "data-state": "online" }, t("gatewayOnline"))),
            h("p", { className: "code muted" }, `${t("hostId")}: ${status.hostId}`),
            h("p", { className: "muted" }, `${t("gateway")}: ${status.bindHost}:${status.gatewayPort} · ${status.pairedDevices} ${t("pairedDevices")}`),
            status.lanUrl ? h("p", { className: "code muted" }, `${t("lan")}: ${status.lanUrl}`) : null) : h("p", { className: "muted", role: "status" }, error ? t("statusUnavailable") : t("loading"))),
        h("section", { className: "panel" },
          h("h3", null, t("pairDevice")), h("p", { className: "muted" }, t("pairHint")),
          h("form", { onSubmit: (event) => { event.preventDefault(); void generate(); }, className: "row", style: { alignItems: "flex-end" } },
            h("label", { className: "field", style: { flex: "1 1 240px" } }, t("address"), h("input", { value: url, onChange: (event) => setUrl(event.target.value), placeholder: status?.lanUrl || "https://dsh.example.com", spellCheck: false, disabled: working })),
            h("button", { type: "submit", disabled: working, className: "primary" }, working ? t("working") : t("generate"))),
          qr ? h("div", { className: "list" }, h("img", { src: qr.qr, alt: t("qrAlt"), width: 240, height: 240, style: { maxWidth: "100%", height: "auto", alignSelf: "center", borderRadius: 8 } }),
            h("p", { className: "code" }, qr.url), h("p", { className: "muted" }, `${t("expires")} ${expires} · ${t("regenerate")}`)) : null));
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, dictionaries), `${NS}: dictionaries`);
      ctx.effect(installStyles, `${NS}: styles`);
      ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
        { name: "shell.overlay", id: "dsh-network-app-banner", order: 100, label: () => t("bannerLabel") },
        () => h(AppBanner, { t })
      )), `${NS}: app banner`);
      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "network", order: 40, label: () => t("title") },
        () => h(NetworkSettings, { t, locale: ctx.locale })
      )), `${NS}: settings`);
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  }
});
