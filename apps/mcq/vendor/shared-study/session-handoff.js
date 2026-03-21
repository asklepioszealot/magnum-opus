(function attachSharedStudy(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedStudy || {};
  if (
    typeof existingNamespace.createSessionDraft === "function" &&
    typeof existingNamespace.recordHandoff === "function"
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

  function normalizeDuration(value, fallback = 30) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 5) {
      return fallback;
    }

    return Math.min(parsed, 240);
  }

  function makeSessionId() {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `session-${Date.now()}-${randomPart}`;
  }

  function sanitizeTransition(transition) {
    const fromFlowId = normalizeText(transition && transition.fromFlowId);
    const toFlowId = normalizeText(transition && transition.toFlowId);
    if (!fromFlowId || !toFlowId) {
      return null;
    }

    return {
      fromFlowId,
      toFlowId,
      reason: normalizeText(transition && transition.reason, "Manual handoff"),
      carryOverNotes: normalizeText(transition && transition.carryOverNotes),
      createdAt:
        normalizeText(transition && transition.createdAt) || new Date().toISOString(),
    };
  }

  function createSessionDraft(input = {}) {
    const preferredFlowId = normalizeText(input.preferredFlowId);
    const activeFlowId = normalizeText(input.activeFlowId, preferredFlowId);
    const transitions = Array.isArray(input.transitions)
      ? input.transitions.map(sanitizeTransition).filter(Boolean)
      : [];

    return {
      version: 1,
      sessionId: normalizeText(input.sessionId, makeSessionId()),
      createdAt:
        normalizeText(input.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      focus: normalizeText(input.focus, "Untitled study session"),
      durationMinutes: normalizeDuration(input.durationMinutes, 30),
      notes: normalizeText(input.notes),
      preferredFlowId,
      activeFlowId,
      transitions,
    };
  }

  function recordHandoff(session, options = {}) {
    const normalizedSession = createSessionDraft(session);
    const fromFlowId = normalizeText(
      options.fromFlowId,
      normalizedSession.activeFlowId || normalizedSession.preferredFlowId,
    );
    const toFlowId = normalizeText(options.toFlowId);

    if (!fromFlowId || !toFlowId) {
      throw new Error("Both source and target flows are required for handoff.");
    }

    if (fromFlowId === toFlowId) {
      throw new Error("Handoff target must differ from the current flow.");
    }

    const transition = sanitizeTransition({
      fromFlowId,
      toFlowId,
      reason: options.reason,
      carryOverNotes: options.carryOverNotes,
      createdAt: new Date().toISOString(),
    });

    return createSessionDraft({
      ...normalizedSession,
      activeFlowId: toFlowId,
      transitions: [...normalizedSession.transitions, transition],
    });
  }

  function serializeSessionBundle(session) {
    const normalizedSession = createSessionDraft(session);
    return JSON.stringify(
      {
        kind: "study-handoff",
        version: 1,
        exportedAt: new Date().toISOString(),
        session: normalizedSession,
      },
      null,
      2,
    );
  }

  function parseSessionBundle(rawBundle) {
    const parsed = JSON.parse(rawBundle);
    if (!parsed || parsed.kind !== "study-handoff" || !parsed.session) {
      throw new Error("Unsupported handoff bundle.");
    }

    return createSessionDraft(parsed.session);
  }

  globalScope.MagnumSharedStudy = Object.freeze({
    ...existingNamespace,
    createSessionDraft,
    recordHandoff,
    serializeSessionBundle,
    parseSessionBundle,
  });
})(window);
