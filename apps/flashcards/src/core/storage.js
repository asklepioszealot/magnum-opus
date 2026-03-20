(function attachAppStorage(globalScope) {
  "use strict";

  if (globalScope.AppStorage) {
    return;
  }

  if (!globalScope.MagnumSharedStorage) {
    const defaultStorage = globalScope.localStorage;

    function isStorageLike(storage) {
      return (
        storage &&
        typeof storage.getItem === "function" &&
        typeof storage.setItem === "function" &&
        typeof storage.removeItem === "function"
      );
    }

    function normalizeKeyPart(part) {
      if (part === undefined || part === null) {
        return "";
      }

      return String(part).trim();
    }

    function createKeyspace(options = {}) {
      const namespace = normalizeKeyPart(options.namespace);
      const separator =
        typeof options.separator === "string" && options.separator.length > 0
          ? options.separator
          : "_";

      function key(...parts) {
        const normalizedParts = parts
          .map(normalizeKeyPart)
          .filter((part) => part.length > 0);

        if (namespace.length > 0) {
          normalizedParts.unshift(namespace);
        }

        return normalizedParts.join(separator);
      }

      function versionedKey(name, version) {
        return key(name, `v${version}`);
      }

      return Object.freeze({
        key,
        versionedKey,
      });
    }

    function createStorage(options = {}) {
      const storage = options.storage || defaultStorage;
      const keys = createKeyspace({
        namespace: options.namespace,
        separator: options.separator,
      });
      const rawKeys = createKeyspace({
        separator: options.separator,
      });

      function ensureStorage() {
        if (!isStorageLike(storage)) {
          throw new Error("Storage API is not available.");
        }
      }

      function getItem(key) {
        ensureStorage();
        return storage.getItem(key);
      }

      function setItem(key, value) {
        ensureStorage();
        storage.setItem(key, value);
      }

      function removeItem(key) {
        ensureStorage();
        storage.removeItem(key);
      }

      function readJson(key, fallbackValue = null) {
        const rawValue = getItem(key);
        if (!rawValue) {
          return fallbackValue;
        }

        try {
          return JSON.parse(rawValue);
        } catch {
          return fallbackValue;
        }
      }

      function writeJson(key, value) {
        setItem(key, JSON.stringify(value));
      }

      return Object.freeze({
        keys,
        rawKeys,
        getItem,
        setItem,
        removeItem,
        readJson,
        writeJson,
      });
    }

    globalScope.MagnumSharedStorage = Object.freeze({
      createKeyspace,
      createStorage,
    });
  }

  if (
    !globalScope.MagnumSharedStorage ||
    typeof globalScope.MagnumSharedStorage.createStorage !== "function"
  ) {
    throw new Error("Shared storage runtime could not be loaded.");
  }

  globalScope.AppStorage = globalScope.MagnumSharedStorage.createStorage({
    namespace: "fc",
  });
})(window);
