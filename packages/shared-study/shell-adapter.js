(function attachSharedStudyShellAdapter(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedStudy || {};
  if (
    typeof existingNamespace.consumeLaunchPayload === "function" &&
    typeof existingNamespace.renderLaunchBanner === "function" &&
    typeof existingNamespace.renderReturnBanner === "function"
  ) {
    return;
  }

  function ensureLaunchContract() {
    if (
      typeof existingNamespace.createLaunchPayload !== "function" ||
      typeof existingNamespace.decodeLaunchPayload !== "function"
    ) {
      throw new Error("Launch contract helpers must be loaded before shell adapter.");
    }
  }

  function getDesktopInvoke() {
    if (
      globalScope.__TAURI_INTERNALS__ &&
      typeof globalScope.__TAURI_INTERNALS__.invoke === "function"
    ) {
      return globalScope.__TAURI_INTERNALS__.invoke.bind(globalScope.__TAURI_INTERNALS__);
    }

    if (
      globalScope.__TAURI__ &&
      globalScope.__TAURI__.core &&
      typeof globalScope.__TAURI__.core.invoke === "function"
    ) {
      return globalScope.__TAURI__.core.invoke.bind(globalScope.__TAURI__.core);
    }

    return null;
  }

  function normalizeText(value, fallback = "") {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  function formatDuration(minutes) {
    const parsed = Number.parseInt(minutes, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return "Süre belirtilmedi";
    }

    return `${parsed} dk planlandi`;
  }

  function normalizeLaunchPayload(payload) {
    ensureLaunchContract();
    return existingNamespace.createLaunchPayload(payload);
  }

  function readStoredLaunchPayload(storageApi, storageKey) {
    if (
      !storageApi ||
      typeof storageApi.readJson !== "function" ||
      !normalizeText(storageKey)
    ) {
      return null;
    }

    const storedPayload = storageApi.readJson(storageKey);
    if (!storedPayload) {
      return null;
    }

    try {
      return normalizeLaunchPayload(storedPayload);
    } catch (error) {
      console.warn("Stored shell launch payload could not be restored.", error);
      return null;
    }
  }

  function persistLaunchPayload(storageApi, storageKey, payload) {
    if (
      !storageApi ||
      typeof storageApi.writeJson !== "function" ||
      !normalizeText(storageKey)
    ) {
      return;
    }

    storageApi.writeJson(storageKey, payload);
  }

  function consumeLaunchPayload(options = {}) {
    ensureLaunchContract();

    const expectedFlowId = normalizeText(options.expectedFlowId);
    const search =
      typeof options.search === "string" ? options.search : globalScope.location.search;
    const params = new URLSearchParams(search);
    const encodedPayload = params.get("studyShellLaunch");
    let resolvedPayload = null;

    if (encodedPayload) {
      try {
        resolvedPayload = existingNamespace.decodeLaunchPayload(encodedPayload);
      } catch (error) {
        console.warn("Study shell launch payload could not be decoded.", error);
      }

      if (
        resolvedPayload &&
        expectedFlowId &&
        resolvedPayload.flowId !== expectedFlowId
      ) {
        console.warn(
          `Ignoring shell launch payload for flow "${resolvedPayload.flowId}" inside "${expectedFlowId}".`,
        );
        resolvedPayload = null;
      }

      if (resolvedPayload) {
        persistLaunchPayload(options.storageApi, options.storageKey, resolvedPayload);
      }

      if (
        options.consumeUrl !== false &&
        globalScope.history &&
        typeof globalScope.history.replaceState === "function"
      ) {
        const nextUrl = new URL(globalScope.location.href);
        nextUrl.searchParams.delete("studyShellLaunch");
        globalScope.history.replaceState(
          {},
          globalScope.document && globalScope.document.title ? globalScope.document.title : "",
          `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
        );
      }
    }

    if (!resolvedPayload) {
      resolvedPayload = readStoredLaunchPayload(options.storageApi, options.storageKey);
    }

    return resolvedPayload;
  }

  function ensureLaunchBannerStyles() {
    if (!globalScope.document || globalScope.document.getElementById("study-shell-banner-styles")) {
      return;
    }

    const styleEl = globalScope.document.createElement("style");
    styleEl.id = "study-shell-banner-styles";
    styleEl.textContent = `
      .study-shell-banner {
        margin: 0 auto 18px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid rgba(47, 122, 86, 0.22);
        background: rgba(47, 122, 86, 0.08);
        color: var(--color-text-primary, #21302a);
        box-shadow: 0 12px 32px rgba(20, 38, 30, 0.08);
      }

      .study-shell-banner strong {
        display: block;
        margin-bottom: 4px;
        font-size: 14px;
        letter-spacing: 0.01em;
      }

      .study-shell-banner-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        font-size: 13px;
        color: var(--color-text-secondary, #5f6d66);
      }

      .study-shell-banner-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 12px;
      }

      .study-shell-banner-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: #2f7a56;
        color: #ffffff;
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
      }

      [data-theme="dark"] .study-shell-banner {
        background: rgba(47, 122, 86, 0.16);
        border-color: rgba(109, 208, 165, 0.28);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.18);
      }
    `;
    globalScope.document.head.appendChild(styleEl);
  }

  function renderLaunchBanner(options = {}) {
    if (!globalScope.document) {
      return null;
    }

    const payload = options.payload ? normalizeLaunchPayload(options.payload) : null;
    const container = options.container || null;
    const bannerId = normalizeText(options.bannerId, "study-shell-banner");
    if (!container || !payload) {
      return null;
    }

    ensureLaunchBannerStyles();

    let banner = globalScope.document.getElementById(bannerId);
    if (!banner) {
      banner = globalScope.document.createElement("div");
      banner.id = bannerId;
      banner.className = "study-shell-banner";
      container.prepend(banner);
    }

    const flowLabel = normalizeText(options.flowLabel, payload.flowId);
    const focusLabel = normalizeText(payload.session && payload.session.focus, "Odak belirtilmedi");
    const notesLabel = normalizeText(
      payload.session && payload.session.notes,
      "Not aktarilmadi",
    );
    const returnPathLabel = normalizeText(payload.returnPath, "apps/study-shell");

    banner.innerHTML = `
      <strong>Study Shell oturumu baglandi: ${flowLabel}</strong>
      <div class="study-shell-banner-meta">
        <span>Odak: ${focusLabel}</span>
        <span>${formatDuration(payload.session && payload.session.durationMinutes)}</span>
        <span>Donus: ${returnPathLabel}</span>
        <span>Not: ${notesLabel}</span>
      </div>
    `;

    return banner;
  }

  function renderReturnBanner(options = {}) {
    if (!globalScope.document) {
      return null;
    }

    const payload =
      options.payload && typeof existingNamespace.createReturnPayload === "function"
        ? existingNamespace.createReturnPayload(options.payload)
        : null;
    const container = options.container || null;
    const bannerId = normalizeText(options.bannerId, "study-shell-return-banner");
    const linkId = normalizeText(options.linkId, "study-shell-return-link");
    if (!container || !payload) {
      return null;
    }

    ensureLaunchBannerStyles();

    let banner = globalScope.document.getElementById(bannerId);
    if (!banner) {
      banner = globalScope.document.createElement("div");
      banner.id = bannerId;
      banner.className = "study-shell-banner";
      container.prepend(banner);
    }

    const returnUrl =
      typeof existingNamespace.buildReturnUrl === "function"
        ? existingNamespace.buildReturnUrl(payload)
        : "";

    banner.innerHTML = `
      <strong>${normalizeText(options.title, "Study Shell'e dön")}</strong>
      <div class="study-shell-banner-meta">
        <span>${payload.summary.headline}</span>
        <span>${payload.summary.detail}</span>
      </div>
      <div class="study-shell-banner-actions">
        <a
          id="${linkId}"
          class="study-shell-banner-link"
          href="${returnUrl}"
        >
          Shell'e dön
        </a>
      </div>
    `;

    const linkEl = globalScope.document.getElementById(linkId);
    const nativeReturnCommand = normalizeText(options.nativeReturnCommand);
    const desktopInvoke = getDesktopInvoke();
    if (
      linkEl &&
      nativeReturnCommand &&
      desktopInvoke &&
      typeof existingNamespace.encodeReturnPayload === "function"
    ) {
      const encodedPayload = existingNamespace.encodeReturnPayload(payload);
      linkEl.addEventListener("click", async (event) => {
        event.preventDefault();

        try {
          await desktopInvoke(nativeReturnCommand, {
            request: {
              returnPath: payload.returnPath,
              encodedPayload,
            },
          });
        } catch (error) {
          console.warn("Native study shell return failed, using browser fallback.", error);
          const fallbackHref = linkEl.getAttribute("href");
          if (fallbackHref) {
            globalScope.location.href = fallbackHref;
          }
        }
      });
    }

    return banner;
  }

  globalScope.MagnumSharedStudy = Object.freeze({
    ...existingNamespace,
    consumeLaunchPayload,
    renderLaunchBanner,
    renderReturnBanner,
  });
})(window);
