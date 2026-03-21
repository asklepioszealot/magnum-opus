import { buildDistSnapshot } from "../../packages/shared-build/dist-snapshot.mjs";

buildDistSnapshot({
  includeBuildInfo: true,
  extraCopies: [
    {
      from: "../../packages/shared-storage/browser-storage.js",
      to: "vendor/shared-storage/browser-storage.js",
    },
    {
      from: "../../packages/shared-ui/app-storage.js",
      to: "vendor/shared-ui/app-storage.js",
    },
    {
      from: "../../packages/shared-ui/theme.js",
      to: "vendor/shared-ui/theme.js",
    },
    {
      from: "../../packages/shared-study/session-handoff.js",
      to: "vendor/shared-study/session-handoff.js",
    },
    {
      from: "../../packages/shared-study/orchestration.js",
      to: "vendor/shared-study/orchestration.js",
    },
    {
      from: "../../packages/shared-study/launch-contract.js",
      to: "vendor/shared-study/launch-contract.js",
    },
    {
      from: "../../packages/shared-study/return-contract.js",
      to: "vendor/shared-study/return-contract.js",
    },
  ],
});
