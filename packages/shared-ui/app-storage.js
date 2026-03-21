(function attachSharedUiStorage(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedUI || {};

  if (typeof existingNamespace.createAppStorage === "function") {
    return;
  }

  function createAppStorage(options = {}) {
    if (
      !globalScope.MagnumSharedStorage ||
      typeof globalScope.MagnumSharedStorage.createStorage !== "function"
    ) {
      throw new Error("Shared storage runtime could not be loaded.");
    }

    const namespace =
      typeof options.namespace === "string" ? options.namespace.trim() : "";

    return globalScope.MagnumSharedStorage.createStorage({
      namespace,
      separator: options.separator,
      storage: options.storage,
    });
  }

  globalScope.MagnumSharedUI = Object.freeze({
    ...existingNamespace,
    createAppStorage,
  });
})(window);
