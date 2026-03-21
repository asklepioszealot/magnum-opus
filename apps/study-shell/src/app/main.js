(function bootstrapStudyShell(globalScope) {
  "use strict";

  if (
    !globalScope.MagnumSharedUI ||
    typeof globalScope.MagnumSharedUI.createAppStorage !== "function" ||
    !globalScope.MagnumSharedUI.ThemeManager ||
    !globalScope.MagnumSharedStudy
  ) {
    throw new Error("Shared shell runtime is not available.");
  }

  const storage = globalScope.MagnumSharedUI.createAppStorage({
    namespace: "study_shell",
  });
  globalScope.AppStorage = storage;

  const themeManager = globalScope.MagnumSharedUI.ThemeManager;
  const sharedStudy = globalScope.MagnumSharedStudy;
  const storageKeys = storage.keys;

  const PREFERRED_FLOW_KEY = storageKeys.key("preferred_flow");
  const LAST_SELECTED_FLOW_KEY = storageKeys.key("last_selected_flow");
  const ACTIVE_FLOW_KEY = storageKeys.key("active_flow");
  const SESSION_STATE_KEY = storageKeys.key("session_state");
  const ORCHESTRATION_PLAN_KEY = storageKeys.key("orchestration_plan");
  const LAST_RETURN_PAYLOAD_KEY = storageKeys.key("last_return_payload");
  const THEME_KEY = storageKeys.key("theme");
  const PENDING_NATIVE_RETURN_KEY = "__MAGNUM_PENDING_STUDY_SHELL_RETURN__";

  const flowCatalog = [
    {
      id: "flashcards",
      title: "Flashcards",
      tagline: "Recall-first repetition",
      description:
        "Best for active recall, self-assessment, and revisiting explanation-heavy study notes.",
      appPath: "apps/flashcards",
      dataShape: "cards[]",
      shellRole: "Phase B catalog entry ready for shell-level launch and later orchestration.",
      highlights: [
        "Subject-based filtering",
        "Assessment tracking",
        "Build metadata support",
      ],
      launchSteps: [
        "Choose the card set and subject scope",
        "Start with recall-focused passes",
        "Use assessment signals before switching flow",
      ],
    },
    {
      id: "mcq",
      title: "MCQ",
      tagline: "Exam-style question drills",
      description:
        "Best for option evaluation, answer checking, and explanation review in test-like study sessions.",
      appPath: "apps/mcq",
      dataShape: "questions[]",
      shellRole: "Phase B catalog entry ready for shared study routing and future handoff flows.",
      highlights: [
        "Set manager workflow",
        "Answer persistence",
        "Wrong-answer retry loop",
      ],
      launchSteps: [
        "Load the target question sets",
        "Work through the option-review cycle",
        "Use wrong-answer retry before returning to shell",
      ],
    },
  ];

  function syncUrlWithActiveFlow(flowId) {
    const url = new URL(globalScope.location.href);
    if (flowId) {
      url.searchParams.set("flow", flowId);
    } else {
      url.searchParams.delete("flow");
    }
    globalScope.history.replaceState({}, "", url);
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "Henüz seçilmedi";
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }

    return parsed.toLocaleString("tr-TR", { hour12: false });
  }

  function renderBuildMeta() {
    const buildInfo = globalScope.__BUILD_INFO__;
    const metaEl = document.getElementById("build-meta");
    if (!metaEl || !buildInfo || typeof buildInfo !== "object") {
      return;
    }

    const version = buildInfo.version || "unknown";
    const commit = buildInfo.commit || "nogit";
    const builtAt = formatTimestamp(buildInfo.builtAt);
    metaEl.textContent = `Build ${version} (${commit}) | ${builtAt}`;
  }

  function getFlowById(flowId) {
    return flowCatalog.find((flow) => flow.id === flowId) || flowCatalog[0];
  }

  function setPreferredFlow(flowId) {
    const flow = getFlowById(flowId);
    storage.setItem(PREFERRED_FLOW_KEY, flow.id);
    storage.writeJson(LAST_SELECTED_FLOW_KEY, {
      flowId: flow.id,
      selectedAt: new Date().toISOString(),
    });
    render();
  }

  function readSessionState() {
    const rawSession = storage.readJson(SESSION_STATE_KEY, null);
    if (!rawSession || typeof rawSession !== "object") {
      return null;
    }

    try {
      return sharedStudy.createSessionDraft(rawSession);
    } catch {
      return null;
    }
  }

  function saveSessionState(session) {
    storage.writeJson(SESSION_STATE_KEY, session);
  }

  function readOrchestrationPlan() {
    return storage.readJson(ORCHESTRATION_PLAN_KEY, null);
  }

  function saveOrchestrationPlan(plan) {
    storage.writeJson(ORCHESTRATION_PLAN_KEY, plan);
  }

  function readLastReturnPayload() {
    const rawPayload = storage.readJson(LAST_RETURN_PAYLOAD_KEY, null);
    if (!rawPayload || typeof rawPayload !== "object") {
      return null;
    }

    try {
      return sharedStudy.createReturnPayload(rawPayload);
    } catch {
      return null;
    }
  }

  function saveLastReturnPayload(payload) {
    storage.writeJson(LAST_RETURN_PAYLOAD_KEY, payload);
  }

  function syncOrchestrationPlan(session) {
    const existingPlan = readOrchestrationPlan();
    const completedFlowIds =
      existingPlan && Array.isArray(existingPlan.completedFlowIds)
        ? existingPlan.completedFlowIds
        : [];
    const plan = sharedStudy.createOrchestrationPlan({
      session,
      flowCatalog,
      completedFlowIds,
    });
    saveOrchestrationPlan(plan);
    return plan;
  }

  function setSessionStatus(message) {
    const statusEl = document.getElementById("session-status");
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  function collectSessionFormState(preferredFlowId, activeFlowId) {
    const focusInput = document.getElementById("session-focus");
    const durationInput = document.getElementById("session-duration");
    const notesInput = document.getElementById("session-notes");
    const existingSession = readSessionState();

    return sharedStudy.createSessionDraft({
      sessionId: existingSession && existingSession.sessionId,
      createdAt: existingSession && existingSession.createdAt,
      transitions: existingSession && existingSession.transitions,
      preferredFlowId,
      activeFlowId,
      focus: focusInput ? focusInput.value : "",
      durationMinutes: durationInput ? durationInput.value : 30,
      notes: notesInput ? notesInput.value : "",
    });
  }

  function readActiveFlowId() {
    const params = new URLSearchParams(globalScope.location.search);
    const flowFromUrl = params.get("flow");
    if (flowFromUrl && flowCatalog.some((flow) => flow.id === flowFromUrl)) {
      storage.setItem(ACTIVE_FLOW_KEY, flowFromUrl);
      return flowFromUrl;
    }

    const storedFlowId = storage.getItem(ACTIVE_FLOW_KEY);
    if (storedFlowId && flowCatalog.some((flow) => flow.id === storedFlowId)) {
      syncUrlWithActiveFlow(storedFlowId);
      return storedFlowId;
    }

    return "";
  }

  function setActiveFlow(flowId) {
    const flow = getFlowById(flowId);
    storage.setItem(ACTIVE_FLOW_KEY, flow.id);
    syncUrlWithActiveFlow(flow.id);
    const session = readSessionState();
    if (session) {
      const updatedSession = sharedStudy.createSessionDraft({
        ...session,
        activeFlowId: flow.id,
      });
      saveSessionState(updatedSession);
      syncOrchestrationPlan(updatedSession);
    }
    render();
  }

  function clearActiveFlow() {
    storage.removeItem(ACTIVE_FLOW_KEY);
    syncUrlWithActiveFlow("");
    render();
  }

  function readPreferredFlowId() {
    return storage.getItem(PREFERRED_FLOW_KEY) || flowCatalog[0].id;
  }

  function renderFlowCatalog(preferredFlowId, activeFlowId) {
    const listEl = document.getElementById("flow-list");
    if (!listEl) {
      return;
    }

    listEl.innerHTML = "";

    flowCatalog.forEach((flow) => {
      const isPreferred = flow.id === preferredFlowId;
      const isActive = flow.id === activeFlowId;
      const article = document.createElement("article");
      article.className = "flow-card";
      article.dataset.flowId = flow.id;
      article.dataset.preferred = isPreferred ? "true" : "false";
      article.dataset.active = isActive ? "true" : "false";

      article.innerHTML = `
        <div class="flow-card-header">
          <div>
            <p class="flow-tagline">${flow.tagline}</p>
            <h3>${flow.title}</h3>
          </div>
          <span class="flow-badge">${flow.dataShape}</span>
        </div>
        <p class="flow-description">${flow.description}</p>
        <p class="flow-role">${flow.shellRole}</p>
        <ul class="flow-highlights">
          ${flow.highlights.map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <div class="flow-footer">
          <code>${flow.appPath}</code>
          <div class="flow-actions">
            <button
              type="button"
              class="btn ${isPreferred ? "btn-secondary" : ""}"
              data-testid="select-${flow.id}"
              data-action="select-flow"
              data-flow-id="${flow.id}"
            >
              ${isPreferred ? "Varsayılan akış" : "Varsayılan yap"}
            </button>
            <button
              type="button"
              class="btn ${isActive ? "btn-secondary" : ""}"
              data-testid="open-${flow.id}"
              data-action="open-flow"
              data-flow-id="${flow.id}"
            >
              ${isActive ? "Akış açık" : "Akışı aç"}
            </button>
          </div>
        </div>
      `;

      listEl.appendChild(article);
    });
  }

  function renderShellStatus(preferredFlowId, activeFlowId) {
    const preferredFlow = getFlowById(preferredFlowId);
    const activeFlow = activeFlowId ? getFlowById(activeFlowId) : null;
    const lastSelected = storage.readJson(LAST_SELECTED_FLOW_KEY, null);

    const statusEl = document.getElementById("shell-status");
    const lastUpdatedEl = document.getElementById("last-updated");
    const shellScopeEl = document.getElementById("shell-scope");
    const appBoundaryEl = document.getElementById("app-boundary");

    if (statusEl) {
      statusEl.textContent = activeFlow
        ? `Açık akış: ${activeFlow.title}. Shell şu anda bu akış için çalışma yüzeyini tutuyor.`
        : `Varsayılan başlangıç akışı: ${preferredFlow.title}. ` +
          "Bu slice shell kataloğu, open-flow durumu ve tercih saklamayı kurar.";
    }

    if (lastUpdatedEl) {
      const selectedAt = lastSelected && typeof lastSelected.selectedAt === "string"
        ? lastSelected.selectedAt
        : "";
      lastUpdatedEl.textContent = formatTimestamp(selectedAt);
    }

    if (shellScopeEl) {
      shellScopeEl.innerHTML = `
        <li>Shared flow catalog for Flashcards and MCQ</li>
        <li>Preferred mode persistence in shell-owned storage</li>
        <li>Theme and build metadata shared runtime wiring</li>
      `;
    }

    if (appBoundaryEl) {
      appBoundaryEl.innerHTML = `
        <li>Flashcards keeps card flow and assessments</li>
        <li>MCQ keeps question solving and answer persistence</li>
        <li>Cross-app launch/handoff remains a later Phase B expansion</li>
      `;
    }
  }

  function renderSessionPanel(preferredFlowId, activeFlowId) {
    const session = readSessionState();
    const focusInput = document.getElementById("session-focus");
    const durationInput = document.getElementById("session-duration");
    const notesInput = document.getElementById("session-notes");
    const handoffTarget = document.getElementById("handoff-target");
    const handoffBundle = document.getElementById("handoff-bundle");

    if (!focusInput || !durationInput || !notesInput || !handoffTarget || !handoffBundle) {
      return;
    }

    focusInput.value = session ? session.focus : focusInput.value;
    durationInput.value = session ? String(session.durationMinutes) : durationInput.value;
    notesInput.value = session ? session.notes : notesInput.value;

    const currentFlowId = activeFlowId || preferredFlowId;
    const handoffCandidates = flowCatalog.filter((flow) => flow.id !== currentFlowId);
    handoffTarget.innerHTML = handoffCandidates
      .map((flow) => `<option value="${flow.id}">${flow.title}</option>`)
      .join("");

    if (session) {
      setSessionStatus(
        `Aktif oturum: ${session.focus} | ${session.durationMinutes} dk | ` +
          `${session.transitions.length} handoff`,
      );
      handoffBundle.value = sharedStudy.serializeSessionBundle(session);
      return;
    }

    setSessionStatus("Henüz shell session oluşturulmadı.");
    handoffBundle.value = "";
  }

  function renderReturnLoop() {
    const statusEl = document.getElementById("return-loop-status");
    const metricsEl = document.getElementById("return-loop-metrics");
    if (!statusEl || !metricsEl) {
      return;
    }

    const payload = readLastReturnPayload();
    if (!payload) {
      statusEl.textContent = "Henüz bir uygulama shell'e geri dönmedi.";
      metricsEl.innerHTML = "";
      return;
    }

    statusEl.textContent =
      `${getFlowById(payload.flowId).title} geri döndü: ${payload.summary.headline}`;
    metricsEl.innerHTML = Object.entries(payload.summary.metrics || {})
      .map(([key, value]) => `<li>${key}: ${value}</li>`)
      .join("");
  }

  function renderOrchestrationPlan(preferredFlowId, activeFlowId) {
    const statusEl = document.getElementById("orchestration-status");
    const listEl = document.getElementById("orchestration-list");
    if (!statusEl || !listEl) {
      return;
    }

    const session =
      readSessionState() ||
      sharedStudy.createSessionDraft({
        preferredFlowId,
        activeFlowId,
        focus: "Shell orchestration preview",
      });
    const plan = sharedStudy.createOrchestrationPlan({
      session,
      flowCatalog,
      completedFlowIds:
        readOrchestrationPlan() && Array.isArray(readOrchestrationPlan().completedFlowIds)
          ? readOrchestrationPlan().completedFlowIds
          : [],
    });
    saveOrchestrationPlan(plan);

    statusEl.textContent = `${plan.strategy} | Sonraki öneri: ${
      plan.nextFlowId ? getFlowById(plan.nextFlowId).title : "Tamamlandı"
    }`;

    listEl.innerHTML = plan.steps
      .map(
        (step) =>
          `<li data-status="${step.status}">${step.order}. ${step.title} — ${step.status}</li>`,
      )
      .join("");
  }

  function renderActiveFlowWorkspace(activeFlowId) {
    const workspaceEl = document.getElementById("active-flow-workspace");
    const emptyStateEl = document.getElementById("workspace-empty-state");
    const titleEl = document.getElementById("workspace-title");
    const descriptionEl = document.getElementById("workspace-description");
    const appPathEl = document.getElementById("workspace-app-path");
    const checklistEl = document.getElementById("workspace-checklist");
    const launchUrlEl = document.getElementById("launch-url");
    const launchPayloadEl = document.getElementById("launch-payload");
    const launchFeedbackEl = document.getElementById("launch-feedback");
    const launchButton = document.querySelector('[data-action="launch-active-flow"]');

    if (
      !workspaceEl ||
      !emptyStateEl ||
      !titleEl ||
      !descriptionEl ||
      !appPathEl ||
      !checklistEl ||
      !launchUrlEl ||
      !launchPayloadEl ||
      !launchFeedbackEl ||
      !launchButton
    ) {
      return;
    }

    if (!activeFlowId) {
      workspaceEl.hidden = true;
      emptyStateEl.hidden = false;
      checklistEl.innerHTML = "";
      launchUrlEl.value = "";
      launchPayloadEl.value = "";
      launchButton.removeAttribute("data-flow-id");
      launchFeedbackEl.textContent =
        "Masaüstü launch Tauri içinden child app executable açar.";
      return;
    }

    const activeFlow = getFlowById(activeFlowId);
    const session =
      readSessionState() ||
      sharedStudy.createSessionDraft({
        preferredFlowId: readPreferredFlowId(),
        activeFlowId,
        focus: "Shell launch preview",
      });
    const launchPayload = sharedStudy.createLaunchPayload({
      flowId: activeFlow.id,
      appPath: activeFlow.appPath,
      returnPath: "apps/study-shell",
      session,
    });
    titleEl.textContent = `${activeFlow.title} Workspace`;
    descriptionEl.textContent =
      `${activeFlow.description} Shell bu adımda akışı açar ve geri dönüş noktasını korur.`;
    appPathEl.textContent = activeFlow.appPath;
    checklistEl.innerHTML = activeFlow.launchSteps
      .map((step) => `<li>${step}</li>`)
      .join("");
    launchPayloadEl.value = JSON.stringify(launchPayload, null, 2);
    launchUrlEl.value = sharedStudy.buildLaunchUrl(launchPayload);
    launchButton.setAttribute("data-flow-id", activeFlow.id);
    launchFeedbackEl.textContent =
      "Launch butonu Tauri içinde aktif akışı doğrudan child app olarak açar.";

    emptyStateEl.hidden = true;
    workspaceEl.hidden = false;
  }

  function getDesktopLauncher() {
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

  function setLaunchFeedback(message) {
    const feedbackEl = document.getElementById("launch-feedback");
    if (feedbackEl) {
      feedbackEl.textContent = message;
    }
  }

  function buildActiveLaunchContext(flowId) {
    const activeFlow = getFlowById(flowId);
    const session =
      readSessionState() ||
      sharedStudy.createSessionDraft({
        preferredFlowId: readPreferredFlowId(),
        activeFlowId: flowId,
        focus: "Shell launch preview",
      });
    const launchPayload = sharedStudy.createLaunchPayload({
      flowId: activeFlow.id,
      appPath: activeFlow.appPath,
      returnPath: "apps/study-shell",
      session,
    });

    return {
      flow: activeFlow,
      launchPayload,
      launchUrl: sharedStudy.buildLaunchUrl(launchPayload),
      encodedPayload:
        typeof sharedStudy.encodeLaunchPayload === "function"
          ? sharedStudy.encodeLaunchPayload(launchPayload)
          : "",
    };
  }

  async function launchActiveFlowDesktop(flowId) {
    const invoke = getDesktopLauncher();
    if (!invoke) {
      setLaunchFeedback(
        "Tarayıcı modunda masaüstü launch kullanılamıyor. Launch URL alanı önizleme için hazır.",
      );
      return;
    }

    const context = buildActiveLaunchContext(flowId);
    setLaunchFeedback(`${context.flow.title} masaüstünde açılıyor...`);

    try {
      const result = await invoke("launch_flow_app", {
        request: {
          flowId: context.flow.id,
          appPath: context.flow.appPath,
          encodedPayload: context.encodedPayload,
        },
      });
      const launchMode =
        result && typeof result.mode === "string" ? result.mode : "desktop_executable";
      setLaunchFeedback(
        `${context.flow.title} açıldı. Launch modu: ${launchMode}.`,
      );
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? error.message
          : String(error || "Bilinmeyen launch hatası");
      setLaunchFeedback(`Launch başarısız: ${message}`);
    }
  }

  function render() {
    const preferredFlowId = readPreferredFlowId();
    const activeFlowId = readActiveFlowId();
    renderFlowCatalog(preferredFlowId, activeFlowId);
    renderShellStatus(preferredFlowId, activeFlowId);
    renderActiveFlowWorkspace(activeFlowId);
    renderSessionPanel(preferredFlowId, activeFlowId);
    renderOrchestrationPlan(preferredFlowId, activeFlowId);
    renderReturnLoop();
    renderBuildMeta();
  }

  function applyReturnPayload(payload) {
    if (!payload) {
      return null;
    }

    saveLastReturnPayload(payload);
    saveSessionState(payload.session);

    const existingPlan = readOrchestrationPlan();
    const seededPlan = sharedStudy.createOrchestrationPlan({
      session: payload.session,
      flowCatalog,
      completedFlowIds:
        existingPlan && Array.isArray(existingPlan.completedFlowIds)
          ? existingPlan.completedFlowIds
          : [],
    });
    const nextPlan = sharedStudy.completeOrchestrationStep(
      seededPlan,
      payload.flowId,
    );
    saveOrchestrationPlan(nextPlan);

    if (nextPlan.nextFlowId) {
      const advancedSession = sharedStudy.createSessionDraft({
        ...payload.session,
        activeFlowId: nextPlan.nextFlowId,
      });
      saveSessionState(advancedSession);
      storage.setItem(ACTIVE_FLOW_KEY, nextPlan.nextFlowId);
      syncUrlWithActiveFlow(nextPlan.nextFlowId);
    } else {
      storage.removeItem(ACTIVE_FLOW_KEY);
      syncUrlWithActiveFlow("");
    }

    render();
    return payload;
  }

  function applyEncodedReturnPayload(encodedPayload) {
    if (!encodedPayload || typeof sharedStudy.decodeReturnPayload !== "function") {
      return null;
    }

    try {
      const payload = sharedStudy.decodeReturnPayload(encodedPayload);
      return applyReturnPayload(payload);
    } catch (error) {
      console.warn("Study shell return payload could not be decoded.", error);
      return null;
    }
  }

  function consumePendingNativeReturnPayload() {
    const pendingReturn = globalScope[PENDING_NATIVE_RETURN_KEY];
    if (!pendingReturn) {
      return null;
    }

    delete globalScope[PENDING_NATIVE_RETURN_KEY];

    const encodedPayload =
      pendingReturn && typeof pendingReturn === "object"
        ? pendingReturn.encodedPayload
        : pendingReturn;
    return applyEncodedReturnPayload(
      typeof encodedPayload === "string" ? encodedPayload : "",
    );
  }

  function consumeReturnPayloadFromUrl() {
    const params = new URLSearchParams(globalScope.location.search);
    const encodedPayload = params.get("studyShellReturn");
    if (!encodedPayload) {
      return null;
    }

    const nextUrl = new URL(globalScope.location.href);
    nextUrl.searchParams.delete("studyShellReturn");
    globalScope.history.replaceState(
      {},
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );

    return applyEncodedReturnPayload(encodedPayload);
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const flowId = target.getAttribute("data-flow-id");
    const action = target.getAttribute("data-action");

    if (action === "save-session") {
      const session = collectSessionFormState(readPreferredFlowId(), readActiveFlowId());
      saveSessionState(session);
      syncOrchestrationPlan(session);
      render();
      return;
    }

    if (action === "handoff-session") {
      const activeFlowId = readActiveFlowId() || readPreferredFlowId();
      const handoffTarget = document.getElementById("handoff-target");
      const reasonInput = document.getElementById("handoff-reason");
      const session = collectSessionFormState(readPreferredFlowId(), activeFlowId);
      const nextSession = sharedStudy.recordHandoff(session, {
        fromFlowId: activeFlowId,
        toFlowId: handoffTarget ? handoffTarget.value : "",
        reason: reasonInput ? reasonInput.value : "",
        carryOverNotes: session.notes,
      });
      saveSessionState(nextSession);
      syncOrchestrationPlan(nextSession);
      storage.setItem(ACTIVE_FLOW_KEY, nextSession.activeFlowId);
      syncUrlWithActiveFlow(nextSession.activeFlowId);
      render();
      return;
    }

    if (action === "import-bundle") {
      const importInput = document.getElementById("import-bundle-input");
      const rawBundle = importInput ? importInput.value : "";
      const importedSession = sharedStudy.parseSessionBundle(rawBundle);
      saveSessionState(importedSession);
      syncOrchestrationPlan(importedSession);
      storage.setItem(ACTIVE_FLOW_KEY, importedSession.activeFlowId);
      syncUrlWithActiveFlow(importedSession.activeFlowId);
      render();
      return;
    }

    if (action === "complete-current-step") {
      const activeFlowId = readActiveFlowId() || readPreferredFlowId();
      const currentPlan = readOrchestrationPlan();
      if (!currentPlan || !activeFlowId) {
        return;
      }

      const nextPlan = sharedStudy.completeOrchestrationStep(currentPlan, activeFlowId);
      saveOrchestrationPlan(nextPlan);

      if (nextPlan.nextFlowId) {
        const session = readSessionState();
        if (session) {
          const advancedSession = sharedStudy.createSessionDraft({
            ...session,
            activeFlowId: nextPlan.nextFlowId,
          });
          saveSessionState(advancedSession);
        }
        storage.setItem(ACTIVE_FLOW_KEY, nextPlan.nextFlowId);
        syncUrlWithActiveFlow(nextPlan.nextFlowId);
      }

      render();
      return;
    }

    if (!flowId) {
      if (action === "close-workspace") {
        clearActiveFlow();
      }
      return;
    }

    if (action === "select-flow") {
      setPreferredFlow(flowId);
      return;
    }

    if (action === "launch-active-flow") {
      await launchActiveFlowDesktop(flowId);
      return;
    }

    if (action === "open-flow") {
      setActiveFlow(flowId);
      return;
    }
  });

  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      themeManager.toggleTheme({
        primaryToggleId: "theme-toggle",
        storageApi: storage,
        storageKey: THEME_KEY,
      });
    });
  }

  themeManager.initThemeFromStorage({
    primaryToggleId: "theme-toggle",
    storageApi: storage,
    storageKey: THEME_KEY,
  });

  globalScope.addEventListener("magnum-study-shell-return", (event) => {
    applyEncodedReturnPayload(
      event && event.detail ? event.detail.encodedPayload : "",
    );
  });

  consumeReturnPayloadFromUrl();
  consumePendingNativeReturnPayload();
  render();
})(window);
