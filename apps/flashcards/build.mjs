import { buildDistSnapshot } from "../../packages/shared-build/dist-snapshot.mjs";

buildDistSnapshot({
  includeBuildInfo: true,
  extraCopies: [
    {
      from: "../../packages/shared-storage/browser-storage.js",
      to: "vendor/shared-storage/browser-storage.js",
    },
  ],
});
