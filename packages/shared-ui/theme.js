(function attachSharedUiTheme(globalScope) {
  "use strict";

  const existingNamespace = globalScope.MagnumSharedUI || {};
  if (existingNamespace.ThemeManager) {
    return;
  }

  function setToggleState(toggleId, isDark) {
    const toggle = document.getElementById(toggleId);
    if (toggle) {
      toggle.checked = isDark;
    }
  }

  function syncThemeToggles(primaryToggleId, secondaryToggleIds, isDark) {
    setToggleState(primaryToggleId, isDark);
    secondaryToggleIds.forEach((toggleId) => {
      setToggleState(toggleId, isDark);
    });
  }

  function applyThemeAttribute(isDark) {
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
      return;
    }

    document.documentElement.removeAttribute("data-theme");
  }

  function resolveSecondaryToggleIds(options = {}) {
    const secondaryToggleIds = Array.isArray(options.secondaryToggleIds)
      ? options.secondaryToggleIds.filter((toggleId) => typeof toggleId === "string")
      : [];

    if (typeof options.managerToggleId === "string") {
      secondaryToggleIds.push(options.managerToggleId);
    }

    return secondaryToggleIds;
  }

  function setThemeState(isDark, options = {}) {
    const primaryToggleId = options.primaryToggleId || "theme-toggle";
    const secondaryToggleIds = resolveSecondaryToggleIds(options);

    syncThemeToggles(primaryToggleId, secondaryToggleIds, isDark);
    applyThemeAttribute(isDark);
    return isDark;
  }

  function toggleTheme(options = {}) {
    const primaryToggleId = options.primaryToggleId || "theme-toggle";
    const secondaryToggleIds = resolveSecondaryToggleIds(options);

    let isDark;
    if (typeof options.isChecked === "boolean") {
      isDark = options.isChecked;
      syncThemeToggles(primaryToggleId, secondaryToggleIds, isDark);
    } else {
      const primaryToggle = document.getElementById(primaryToggleId);
      isDark = Boolean(primaryToggle && primaryToggle.checked);
      secondaryToggleIds.forEach((toggleId) => setToggleState(toggleId, isDark));
    }

    applyThemeAttribute(isDark);

    if (options.storageKey) {
      const storageApi = options.storageApi || globalScope.AppStorage;
      if (storageApi && typeof storageApi.setItem === "function") {
        storageApi.setItem(options.storageKey, isDark ? "dark" : "light");
      }
    }

    if (typeof options.onAfterToggle === "function") {
      options.onAfterToggle(isDark);
    }

    return isDark;
  }

  function initThemeFromStorage(options = {}) {
    const storageApi = options.storageApi || globalScope.AppStorage;
    let isDark = false;

    if (options.storageKey && storageApi && typeof storageApi.getItem === "function") {
      isDark = storageApi.getItem(options.storageKey) === "dark";
    }

    return setThemeState(isDark, options);
  }

  const themeManager = Object.freeze({
    toggleTheme,
    initThemeFromStorage,
    setThemeState,
  });

  globalScope.MagnumSharedUI = Object.freeze({
    ...existingNamespace,
    ThemeManager: themeManager,
  });
})(window);
