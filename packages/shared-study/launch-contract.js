(function attachSharedStudyLaunchContract(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedStudy || {};
  if (
    typeof existingNamespace.createLaunchPayload === "function" &&
    typeof existingNamespace.buildLaunchUrl === "function"
  ) {
    return;
  }

  function normalizeText(value, fallback = "") {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  function requireSession(existingNamespace, session) {
    if (typeof existingNamespace.createSessionDraft !== "function") {
      throw new Error("Session draft helpers must be loaded before launch contract.");
    }

    return existingNamespace.createSessionDraft(session);
  }

  function createLaunchPayload(input = {}) {
    const flowId = normalizeText(input.flowId);
    const session = requireSession(existingNamespace, input.session || {});

    if (!flowId) {
      throw new Error("Launch payload requires a target flow.");
    }

    const appPath = normalizeText(input.appPath);
    const returnPath = normalizeText(input.returnPath, "apps/study-shell");

    return {
      kind: "study-shell-launch",
      version: 1,
      flowId,
      appPath,
      returnPath,
      createdAt: new Date().toISOString(),
      session,
    };
  }

  function serializeLaunchPayload(payload) {
    const normalizedPayload = createLaunchPayload(payload);
    return JSON.stringify(normalizedPayload);
  }

  function parseLaunchPayload(rawPayload) {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || parsed.kind !== "study-shell-launch") {
      throw new Error("Unsupported launch payload.");
    }

    return createLaunchPayload(parsed);
  }

  function encodeLaunchPayload(payload) {
    return encodeURIComponent(serializeLaunchPayload(payload));
  }

  function decodeLaunchPayload(encodedPayload) {
    return parseLaunchPayload(decodeURIComponent(encodedPayload));
  }

  function buildLaunchUrl(payload) {
    const normalizedPayload = createLaunchPayload(payload);
    const launchUrl = new URL("index.html", "https://study-shell.local/");
    launchUrl.searchParams.set("studyShellLaunch", encodeLaunchPayload(normalizedPayload));
    return `${normalizedPayload.appPath}/${launchUrl.pathname.slice(1)}${launchUrl.search}`;
  }

  globalScope.MagnumSharedStudy = Object.freeze({
    ...existingNamespace,
    createLaunchPayload,
    serializeLaunchPayload,
    parseLaunchPayload,
    encodeLaunchPayload,
    decodeLaunchPayload,
    buildLaunchUrl,
  });
})(window);
