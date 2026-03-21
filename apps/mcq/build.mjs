import { buildDistSnapshot } from "../../packages/shared-build/dist-snapshot.mjs";

buildDistSnapshot({
  extraCopies: [
    {
      from: "../../packages/shared-storage/browser-storage.js",
      to: "vendor/shared-storage/browser-storage.js",
    },
    {
      from: "../../packages/shared-study/session-handoff.js",
      to: "vendor/shared-study/session-handoff.js",
    },
    {
      from: "../../packages/shared-study/launch-contract.js",
      to: "vendor/shared-study/launch-contract.js",
    },
    {
      from: "../../packages/shared-study/return-contract.js",
      to: "vendor/shared-study/return-contract.js",
    },
    {
      from: "../../packages/shared-study/shell-adapter.js",
      to: "vendor/shared-study/shell-adapter.js",
    },
  ],
});
