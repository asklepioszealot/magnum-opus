(function attachSharedStudyReturnContract(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedStudy || {};
  if (
    typeof existingNamespace.createReturnPayload === "function" &&
    typeof existingNamespace.buildReturnUrl === "function"
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

  function requireSession(session) {
    if (typeof existingNamespace.createSessionDraft !== "function") {
      throw new Error("Session draft helpers must be loaded before return contract.");
    }

    return existingNamespace.createSessionDraft(session);
  }

  function sanitizeSummary(summary) {
    const metrics =
      summary && typeof summary.metrics === "object" && !Array.isArray(summary.metrics)
        ? summary.metrics
        : {};

    return {
      headline: normalizeText(summary && summary.headline, "Progress summary unavailable"),
      detail: normalizeText(summary && summary.detail, "No detailed progress was provided."),
      metrics,
    };
  }

  function createReturnPayload(input = {}) {
    const flowId = normalizeText(input.flowId);
    const session = requireSession(input.session || {});

    if (!flowId) {
      throw new Error("Return payload requires a source flow.");
    }

    return {
      kind: "study-shell-return",
      version: 1,
      flowId,
      returnPath: normalizeText(input.returnPath, "apps/study-shell"),
      createdAt: new Date().toISOString(),
      session,
      summary: sanitizeSummary(input.summary),
    };
  }

  function serializeReturnPayload(payload) {
    return JSON.stringify(createReturnPayload(payload));
  }

  function parseReturnPayload(rawPayload) {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || parsed.kind !== "study-shell-return") {
      throw new Error("Unsupported return payload.");
    }

    return createReturnPayload(parsed);
  }

  function encodeReturnPayload(payload) {
    return encodeURIComponent(serializeReturnPayload(payload));
  }

  function decodeReturnPayload(encodedPayload) {
    return parseReturnPayload(decodeURIComponent(encodedPayload));
  }

  function buildReturnUrl(payload) {
    const normalizedPayload = createReturnPayload(payload);
    const returnUrl = new URL("index.html", "https://study-shell.local/");
    returnUrl.searchParams.set("studyShellReturn", encodeReturnPayload(normalizedPayload));
    return `${normalizedPayload.returnPath}/${returnUrl.pathname.slice(1)}${returnUrl.search}`;
  }

  globalScope.MagnumSharedStudy = Object.freeze({
    ...existingNamespace,
    createReturnPayload,
    serializeReturnPayload,
    parseReturnPayload,
    encodeReturnPayload,
    decodeReturnPayload,
    buildReturnUrl,
  });
})(window);
