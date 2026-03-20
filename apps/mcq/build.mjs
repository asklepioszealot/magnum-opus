import { buildDistSnapshot } from "../../packages/shared-build/dist-snapshot.mjs";

buildDistSnapshot({
  extraCopies: [
    {
      from: "../../packages/shared-storage/browser-storage.js",
      to: "vendor/shared-storage/browser-storage.js",
    },
  ],
});
