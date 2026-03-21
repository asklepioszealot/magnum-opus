const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("@playwright/test");

function appUrl() {
  const indexPath = path.resolve(process.cwd(), "dist", "index.html");
  return pathToFileURL(indexPath).toString();
}

function withStudyShellReturn(url, payload) {
  const returnUrl = new URL(url);
  returnUrl.searchParams.set(
    "studyShellReturn",
    encodeURIComponent(JSON.stringify(payload)),
  );
  return returnUrl.toString();
}

async function clearStorage(page) {
  await page.goto(appUrl());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test.describe("Study shell smoke", () => {
  test("renders the shell catalog and shell scope summary", async ({ page }) => {
    await clearStorage(page);

    await expect(page.locator("h1")).toHaveText("Study Shell");
    await expect(page.locator("#flow-list .flow-card")).toHaveCount(2);
    await expect(page.locator("#flow-list")).toContainText("Flashcards");
    await expect(page.locator("#flow-list")).toContainText("MCQ");
    await expect(page.locator("#shell-scope")).toContainText("Shared flow catalog");
    await expect(page.locator("#shell-status")).toContainText("Flashcards");
  });

  test("preferred flow selection persists after reload", async ({ page }) => {
    await clearStorage(page);

    await page.locator('[data-testid="select-mcq"]').click();
    await expect(page.locator("#shell-status")).toContainText("MCQ");

    await expect
      .poll(async () =>
        page.evaluate(() => localStorage.getItem("study_shell_preferred_flow")),
      )
      .toBe("mcq");

    await page.reload();
    await expect(page.locator("#shell-status")).toContainText("MCQ");
    await expect(page.locator('.flow-card[data-flow-id="mcq"]')).toHaveAttribute(
      "data-preferred",
      "true",
    );
  });

  test("theme toggle persists across reload", async ({ page }) => {
    await clearStorage(page);

    await page.locator("#theme-toggle").click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBe("dark");

    await expect
      .poll(async () =>
        page.evaluate(() => localStorage.getItem("study_shell_theme")),
      )
      .toBe("dark");

    await page.reload();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBe("dark");
  });

  test("opening a flow keeps an active workspace across reload", async ({ page }) => {
    await clearStorage(page);

    await page.locator('[data-testid="open-mcq"]').click();
    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#active-flow-workspace")).toBeVisible();
    await expect(page.locator("#workspace-title")).toHaveText("MCQ Workspace");
    await expect(page.locator("#workspace-app-path")).toHaveText("apps/mcq");
    await expect(page.locator("#launch-url")).toHaveValue(
      /apps\/mcq\/index\.html\?studyShellLaunch=/,
    );
    await expect(page.locator("#launch-payload")).toHaveValue(/"flowId": "mcq"/);

    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("study_shell_active_flow")))
      .toBe("mcq");
    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .toContain("flow=mcq");

    await page.reload();
    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#workspace-title")).toHaveText("MCQ Workspace");

    await page.locator('[data-action="close-workspace"]').click();
    await expect(page.locator("#workspace-empty-state")).toBeVisible();
    await expect(page.locator("#active-flow-workspace")).toBeHidden();
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("study_shell_active_flow")))
      .toBe(null);
  });

  test("launch payload is rebuilt from the current session context", async ({ page }) => {
    await clearStorage(page);

    await page.locator('[data-testid="open-flashcards"]').click();
    await page.fill("#session-focus", "Launch contract session");
    await page.fill("#session-notes", "handoff ready");
    await page.locator('[data-action="save-session"]').click();

    await expect(page.locator("#launch-payload")).toHaveValue(
      /"focus": "Launch contract session"/,
    );
    await expect(page.locator("#launch-payload")).toHaveValue(
      /"flowId": "flashcards"/,
    );
    await expect(page.locator("#launch-url")).toHaveValue(
      /studyShellLaunch=/,
    );
  });

  test("desktop launch button invokes the Tauri command when available", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, payload) => {
          window.__studyShellLaunchCall = { command, payload };
          return {
            mode: "desktop_executable",
            target: "D:\\apps\\flashcards.exe",
          };
        },
      };
    });

    await clearStorage(page);

    await page.locator('[data-testid="open-flashcards"]').click();
    await page.fill("#session-focus", "Desktop launch smoke");
    await page.fill("#session-notes", "tauri invoke");
    await page.locator('[data-action="save-session"]').click();
    await page.locator('[data-testid="launch-active-flow"]').click();

    await expect
      .poll(async () =>
        page.evaluate(() => window.__studyShellLaunchCall?.command || ""),
      )
      .toBe("launch_flow_app");

    const launchCall = await page.evaluate(() => window.__studyShellLaunchCall);
    expect(launchCall.payload.request.flowId).toBe("flashcards");
    expect(launchCall.payload.request.appPath).toBe("apps/flashcards");
    expect(launchCall.payload.request.encodedPayload).toContain("%7B");

    await expect(page.locator("#launch-feedback")).toContainText(
      "Flashcards açıldı",
    );
    await expect(page.locator("#launch-feedback")).toContainText(
      "desktop_executable",
    );
  });

  test("session brief and handoff bundle persist through reload", async ({ page }) => {
    await clearStorage(page);

    await page.locator('[data-testid="open-flashcards"]').click();
    await page.fill("#session-focus", "Pediatri tekrar");
    await page.fill("#session-duration", "45");
    await page.fill("#session-notes", "Recall sonrası hızlı sınama");
    await page.locator('[data-action="save-session"]').click();

    await expect(page.locator("#session-status")).toContainText("Pediatri tekrar");
    await expect(page.locator("#session-status")).toContainText("45 dk");

    await page.selectOption("#handoff-target", "mcq");
    await page.fill("#handoff-reason", "Recall sonrası sınama");
    await page.locator('[data-action="handoff-session"]').click();

    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#handoff-bundle")).toHaveValue(
      /"toFlowId": "mcq"/,
    );

    await page.reload();
    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#session-status")).toContainText("1 handoff");
  });

  test("importing a handoff bundle restores the active flow and session", async ({
    page,
  }) => {
    await clearStorage(page);

    const bundle = await page.evaluate(() => {
      const session = window.MagnumSharedStudy.createSessionDraft({
        focus: "Imported session",
        durationMinutes: 35,
        notes: "Imported from another shell",
        preferredFlowId: "flashcards",
        activeFlowId: "mcq",
      });
      return window.MagnumSharedStudy.serializeSessionBundle(session);
    });

    await page.fill("#import-bundle-input", bundle);
    await page.locator('[data-action="import-bundle"]').click();

    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#session-status")).toContainText("Imported session");
    await expect(page.locator("#workspace-title")).toHaveText("MCQ Workspace");
  });

  test("recall-focused sessions get a flashcards-first orchestration plan", async ({
    page,
  }) => {
    await clearStorage(page);

    await page.fill("#session-focus", "Recall pediatri turu");
    await page.fill("#session-notes", "önce recall sonra sınama");
    await page.locator('[data-action="save-session"]').click();

    await expect(page.locator("#orchestration-status")).toContainText(
      "Recall-first orchestration",
    );
    await expect(page.locator("#orchestration-list li").first()).toContainText(
      "Flashcards",
    );
    await expect(page.locator("#orchestration-list li").first()).toContainText(
      "in_progress",
    );
  });

  test("completing the current orchestration step advances the next flow", async ({
    page,
  }) => {
    await clearStorage(page);

    await page.locator('[data-testid="open-flashcards"]').click();
    await page.fill("#session-focus", "Recall pediatri turu");
    await page.fill("#session-notes", "önce recall sonra sınama");
    await page.locator('[data-action="save-session"]').click();

    await page.locator('[data-action="complete-current-step"]').click();

    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#orchestration-list li").first()).toContainText(
      "completed",
    );
    await expect(page.locator("#orchestration-list li").nth(1)).toContainText(
      "in_progress",
    );
  });

  test("return payload advances the orchestration loop and shows summary", async ({
    page,
  }) => {
    await clearStorage(page);

    const returnPayload = {
      kind: "study-shell-return",
      version: 1,
      flowId: "flashcards",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-return",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Recall pediatri turu",
        durationMinutes: 30,
        notes: "önce recall sonra sınama",
        preferredFlowId: "flashcards",
        activeFlowId: "flashcards",
        transitions: [],
      },
      summary: {
        headline: "6/8 kart değerlendirildi",
        detail: "Biliyorum 4, tekrar 2, bilmiyorum 0",
        metrics: {
          know: 4,
          review: 2,
          dunno: 0,
          total: 8,
          assessed: 6,
        },
      },
    };

    await page.goto(withStudyShellReturn(appUrl(), returnPayload));

    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#return-loop-status")).toContainText(
      "Flashcards geri döndü",
    );
    await expect(page.locator("#return-loop-status")).toContainText(
      "6/8 kart değerlendirildi",
    );
    await expect(page.locator("#return-loop-metrics")).toContainText("know: 4");
    await expect(page.locator("#orchestration-list li").first()).toContainText(
      "completed",
    );
    await expect(page.locator("#orchestration-list li").nth(1)).toContainText(
      "in_progress",
    );
    await expect(page.locator("#workspace-title")).toHaveText("MCQ Workspace");

    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .toContain("flow=mcq");
    await expect
      .poll(async () =>
        page.evaluate(() => localStorage.getItem("study_shell_last_return_payload")),
      )
      .not.toBeNull();
  });

  test("native desktop return event is consumed without URL navigation", async ({
    page,
  }) => {
    await clearStorage(page);

    const returnPayload = {
      kind: "study-shell-return",
      version: 1,
      flowId: "flashcards",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-21T01:20:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-native-return",
        createdAt: "2026-03-21T01:20:00.000Z",
        updatedAt: "2026-03-21T01:20:00.000Z",
        focus: "Native return event",
        durationMinutes: 25,
        notes: "desktop return path",
        preferredFlowId: "flashcards",
        activeFlowId: "flashcards",
        transitions: [],
      },
      summary: {
        headline: "3/5 kart değerlendirildi",
        detail: "Biliyorum 2, tekrar 1, bilmiyorum 0",
        metrics: {
          know: 2,
          review: 1,
          dunno: 0,
          total: 5,
          assessed: 3,
        },
      },
    };

    await page.goto(appUrl());

    await page.evaluate((payload) => {
      const encodedPayload =
        window.MagnumSharedStudy.encodeReturnPayload(payload);
      window.dispatchEvent(
        new CustomEvent("magnum-study-shell-return", {
          detail: { encodedPayload },
        }),
      );
    }, returnPayload);

    await expect(page.locator("#shell-status")).toContainText("Açık akış: MCQ");
    await expect(page.locator("#return-loop-status")).toContainText(
      "Flashcards geri döndü",
    );
    await expect(page.locator("#return-loop-status")).toContainText(
      "3/5 kart değerlendirildi",
    );
    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .toContain("flow=mcq");
  });
});
