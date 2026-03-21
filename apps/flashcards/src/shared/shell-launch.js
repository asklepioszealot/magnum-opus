(function attachFlashcardsShellLaunch(globalScope) {
  "use strict";

  const storage = globalScope.AppStorage;
  const storageKey =
    storage && storage.keys && typeof storage.keys.key === "function"
      ? storage.keys.key("shell_launch")
      : "fc_shell_launch";
  const returnPreviewKey =
    storage && storage.keys && typeof storage.keys.key === "function"
      ? storage.keys.key("shell_return_preview")
      : "fc_shell_return_preview";

  function readLaunchPayload() {
    if (!storage || typeof storage.readJson !== "function") {
      return null;
    }

    return storage.readJson(storageKey, null);
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function resolveLaunchPayload(options = {}) {
    if (
      !globalScope.MagnumSharedStudy ||
      typeof globalScope.MagnumSharedStudy.decodeLaunchPayload !== "function"
    ) {
      return null;
    }

    const encodedPayload = normalizeText(options.encodedPayload);
    const expectedFlowId = normalizeText(options.expectedFlowId);
    let resolvedPayload = null;

    if (!encodedPayload) {
      return null;
    }

    try {
      resolvedPayload =
        globalScope.MagnumSharedStudy.decodeLaunchPayload(encodedPayload);
    } catch (error) {
      console.warn("Flashcards native shell launch payload could not be decoded.", error);
      return null;
    }

    if (
      resolvedPayload &&
      expectedFlowId &&
      resolvedPayload.flowId !== expectedFlowId
    ) {
      console.warn(
        `Ignoring native shell launch payload for flow "${resolvedPayload.flowId}" inside "${expectedFlowId}".`,
      );
      return null;
    }

    if (storage && typeof storage.writeJson === "function") {
      storage.writeJson(storageKey, resolvedPayload);
    }

    return resolvedPayload;
  }

  function syncShellLaunch() {
    if (
      !globalScope.MagnumSharedStudy ||
      typeof globalScope.MagnumSharedStudy.consumeLaunchPayload !== "function"
    ) {
      return null;
    }

    try {
      return globalScope.MagnumSharedStudy.consumeLaunchPayload({
        expectedFlowId: "flashcards",
        storageApi: storage,
        storageKey,
      });
    } catch (error) {
      console.warn("Flashcards shell launch payload could not be synced.", error);
      return null;
    }
  }

  function syncNativeShellLaunch(encodedPayload) {
    return resolveLaunchPayload({
      encodedPayload,
      expectedFlowId: "flashcards",
    });
  }

  function renderShellLaunchBanner(payload) {
    if (
      !payload ||
      !globalScope.MagnumSharedStudy ||
      typeof globalScope.MagnumSharedStudy.renderLaunchBanner !== "function"
    ) {
      return null;
    }

    const setManager = globalScope.document.getElementById("set-manager");
    return globalScope.MagnumSharedStudy.renderLaunchBanner({
      payload,
      container: setManager,
      bannerId: "flashcards-shell-launch-banner",
      flowLabel: "Flashcards",
    });
  }

  function renderShellReturnBanner(summary, options = {}) {
    const launchPayload = readLaunchPayload();
    if (
      !launchPayload ||
      !globalScope.MagnumSharedStudy ||
      typeof globalScope.MagnumSharedStudy.createReturnPayload !== "function" ||
      typeof globalScope.MagnumSharedStudy.renderReturnBanner !== "function"
    ) {
      return null;
    }

    const payload = globalScope.MagnumSharedStudy.createReturnPayload({
      flowId: "flashcards",
      returnPath: launchPayload.returnPath,
      session: launchPayload.session,
      summary,
    });

    if (storage && typeof storage.writeJson === "function") {
      storage.writeJson(returnPreviewKey, payload);
    }

    return globalScope.MagnumSharedStudy.renderReturnBanner({
      payload,
      container: options.container,
      bannerId: "flashcards-shell-return-banner",
      linkId: "flashcards-shell-return-link",
      nativeReturnCommand: "return_to_study_shell",
      title: "Study Shell'e ilerleme gönder",
    });
  }

  globalScope.FlashcardsShellLaunch = Object.freeze({
    storageKey,
    returnPreviewKey,
    sync: syncShellLaunch,
    syncNative: syncNativeShellLaunch,
    renderBanner: renderShellLaunchBanner,
    renderReturnBanner: renderShellReturnBanner,
  });
})(window);
