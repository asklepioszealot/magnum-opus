const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("playwright/test");

function appUrl() {
  const indexPath = path.resolve(process.cwd(), "index.html");
  return pathToFileURL(indexPath).toString();
}

function withStudyShellLaunch(url, payload) {
  const launchUrl = new URL(url);
  launchUrl.searchParams.set(
    "studyShellLaunch",
    encodeURIComponent(JSON.stringify(payload)),
  );
  return launchUrl.toString();
}

function legacyQuestionId(questionText, subject = "Genel") {
  let hash = 0;
  const text = `${questionText}${subject}`;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `mc_${hash}`;
}

async function clearStorage(page) {
  await page.goto(appUrl());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function seedLocalSets(page, { sets, selectedSetIds, assessments, session }) {
  await page.goto(appUrl());
  await page.evaluate(
    ({ sets, selectedSetIds, assessments, session }) => {
      localStorage.clear();
      Object.entries(sets).forEach(([setId, setData]) => {
        localStorage.setItem(`mc_set_${setId}`, JSON.stringify(setData));
      });
      const loadedSetIds = Object.keys(sets);
      localStorage.setItem("mc_loaded_sets", JSON.stringify(loadedSetIds));
      localStorage.setItem(
        "mc_selected_sets",
        JSON.stringify(selectedSetIds || loadedSetIds),
      );
      if (assessments) {
        localStorage.setItem("mc_assessments", JSON.stringify(assessments));
      }
      if (session) {
        localStorage.setItem("mc_session", JSON.stringify(session));
      }
    },
    {
      sets,
      selectedSetIds,
      assessments,
      session,
    },
  );
  await page.reload();
}

async function jumpToQuestion(page, questionNumber) {
  await page.fill("#jump-input", String(questionNumber));
  await page.press("#jump-input", "Enter");
  await expect(page.locator("#question-counter")).toContainText(
    `Soru ${questionNumber} /`,
  );
}

async function selectOption(page, optionIndex) {
  await page.locator("#options-container .option").nth(optionIndex).click();
  await page.waitForTimeout(200);
}

test.describe("MCQ smoke", () => {
  test("set manager flow works from upload to start", async ({ page }) => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests",
      "fixtures",
      "smoke-set.json",
    );

    await page.addInitScript(() => localStorage.clear());
    await page.goto(appUrl());

    const setManager = page.locator("#set-manager");
    const mainApp = page.locator("#main-app");
    const startButton = page.locator("#start-btn");

    await expect(setManager).toBeVisible();
    const themeToggleSwitch = page.locator("#set-manager .toggle-switch").first();
    await expect(themeToggleSwitch).toBeVisible();

    await themeToggleSwitch.click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe("dark");

    await themeToggleSwitch.click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBeNull();

    await page.setInputFiles("#file-picker", fixturePath);
    await expect(page.locator("#set-list .set-name", { hasText: "Smoke Test Set" })).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(mainApp).toBeVisible();
    await expect(setManager).toBeHidden();
  });

  test("resume exact question after reload", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Resume Demo",
          fileName: "resume-demo.json",
          questions: [
            {
              q: "Kart A?",
              options: ["A1", "A2", "A3", "A4"],
              correct: 0,
              subject: "Genel",
              explanation: "A",
            },
            {
              q: "Kart B?",
              options: ["B1", "B2", "B3", "B4"],
              correct: 1,
              subject: "Genel",
              explanation: "B",
            },
            {
              q: "Kart C?",
              options: ["C1", "C2", "C3", "C4"],
              correct: 2,
              subject: "Genel",
              explanation: "C",
            },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await page.locator("#next-btn").click();
    await page.locator("#next-btn").click();

    await expect(page.locator("#question-counter")).toHaveText("Soru 3 / 3");
    await expect(page.locator("#question-text")).toContainText("Kart C?");

    await page.reload();
    await page.locator("#start-btn").click();

    await expect(page.locator("#question-counter")).toHaveText("Soru 3 / 3");
    await expect(page.locator("#question-text")).toContainText("Kart C?");
  });

  test("duplicate question across sets keeps answers independent", async ({
    page,
  }) => {
    await seedLocalSets(page, {
      sets: {
        "set-a": {
          setName: "Set A",
          fileName: "set-a.json",
          questions: [
            {
              q: "Aynı soru?",
              options: ["A", "B", "C", "D"],
              correct: 0,
              subject: "Genel",
              explanation: "Set A",
            },
          ],
        },
        "set-b": {
          setName: "Set B",
          fileName: "set-b.json",
          questions: [
            {
              q: "Aynı soru?",
              options: ["A", "B", "C", "D"],
              correct: 1,
              subject: "Genel",
              explanation: "Set B",
            },
          ],
        },
      },
      selectedSetIds: ["set-a", "set-b"],
    });

    await page.locator("#start-btn").click();
    await selectOption(page, 0);
    await page.locator("#next-btn").click();
    await selectOption(page, 1);

    const snapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mc_assessments") || "{}"),
    );
    const selectedAnswers = snapshot.selectedAnswers || {};
    const setScopedEntries = Object.entries(selectedAnswers).filter(([key]) =>
      key.startsWith("set:"),
    );

    expect(setScopedEntries).toHaveLength(2);
    expect(setScopedEntries.map(([, value]) => value).sort()).toEqual([0, 1]);

    await page.reload();
    await page.locator("#start-btn").click();

    await jumpToQuestion(page, 1);
    await jumpToQuestion(page, 2);

    const afterReload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mc_assessments") || "{}"),
    );
    const afterEntries = Object.entries(afterReload.selectedAnswers || {}).filter(
      ([key]) => key.startsWith("set:"),
    );
    expect(afterEntries).toHaveLength(2);
  });

  test("legacy answer keys migrate to set-based keys", async ({ page }) => {
    const questionText = "Legacy soru?";
    const subject = "Genel";
    const legacyKey = legacyQuestionId(questionText, subject);

    await seedLocalSets(page, {
      sets: {
        "set-a": {
          setName: "Set A",
          fileName: "set-a.json",
          questions: [
            {
              q: questionText,
              options: ["A", "B", "C", "D"],
              correct: 0,
              subject,
              explanation: "Set A",
            },
          ],
        },
        "set-b": {
          setName: "Set B",
          fileName: "set-b.json",
          questions: [
            {
              q: questionText,
              options: ["A", "B", "C", "D"],
              correct: 1,
              subject,
              explanation: "Set B",
            },
          ],
        },
      },
      selectedSetIds: ["set-a", "set-b"],
      assessments: {
        selectedAnswers: { [legacyKey]: 1 },
        solutionVisible: { [legacyKey]: true },
      },
    });

    await page.locator("#start-btn").click();

    const migrated = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mc_assessments") || "{}"),
    );
    const migratedAnswers = Object.entries(migrated.selectedAnswers || {}).filter(
      ([key]) => key.startsWith("set:"),
    );
    const migratedVisibility = Object.entries(migrated.solutionVisible || {}).filter(
      ([key]) => key.startsWith("set:"),
    );

    expect(migratedAnswers).toHaveLength(2);
    expect(migratedAnswers.map(([, value]) => value)).toEqual([1, 1]);
    expect(migratedVisibility).toHaveLength(2);
    expect(migratedVisibility.map(([, value]) => value)).toEqual([true, true]);
  });

  test("study shell launch payload is consumed and surfaced in the set manager", async ({
    page,
  }) => {
    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "mcq",
      appPath: "apps/mcq",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-mcq",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Karma test oturumu",
        durationMinutes: 40,
        notes: "Kardiyoloji ve cocuk acil",
        preferredFlowId: "mcq",
        activeFlowId: "mcq",
        transitions: [],
      },
    };

    await page.goto(withStudyShellLaunch(appUrl(), launchPayload));

    await expect(page.locator("#mcq-shell-launch-banner")).toBeVisible();
    await expect(page.locator("#mcq-shell-launch-banner")).toContainText(
      "Study Shell oturumu baglandi: MCQ",
    );
    await expect(page.locator("#mcq-shell-launch-banner")).toContainText(
      "Karma test oturumu",
    );
    await expect(page.locator("#mcq-shell-launch-banner")).toContainText(
      "apps/study-shell",
    );

    await expect.poll(async () =>
      page.evaluate(() => window.location.search),
    ).toBe("");

    const storedPayload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mc_shell_launch") || "null"),
    );
    expect(storedPayload).not.toBeNull();
    expect(storedPayload.flowId).toBe("mcq");
    expect(storedPayload.session.notes).toBe("Kardiyoloji ve cocuk acil");
  });

  test("native desktop launch event is consumed without URL navigation", async ({
    page,
  }) => {
    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "mcq",
      appPath: "apps/mcq",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-21T01:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-mcq-native-launch",
        createdAt: "2026-03-21T01:00:00.000Z",
        updatedAt: "2026-03-21T01:00:00.000Z",
        focus: "Native startup event mcq",
        durationMinutes: 18,
        notes: "no startup navigate",
        preferredFlowId: "mcq",
        activeFlowId: "mcq",
        transitions: [],
      },
    };

    await clearStorage(page);
    await page.goto(appUrl());

    await page.evaluate((payload) => {
      const encodedPayload =
        window.MagnumSharedStudy.encodeLaunchPayload(payload);
      window.dispatchEvent(
        new CustomEvent("magnum-study-shell-launch", {
          detail: { encodedPayload },
        }),
      );
    }, launchPayload);

    await expect(page.locator("#mcq-shell-launch-banner")).toBeVisible();
    await expect(page.locator("#mcq-shell-launch-banner")).toContainText(
      "Native startup event mcq",
    );
    await expect.poll(async () => page.evaluate(() => window.location.search)).toBe(
      "",
    );
  });

  test("study shell return preview updates from quiz progress", async ({
    page,
  }) => {
    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "mcq",
      appPath: "apps/mcq",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-mcq-return",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Return loop mcq",
        durationMinutes: 35,
        notes: "return to shell",
        preferredFlowId: "mcq",
        activeFlowId: "mcq",
        transitions: [],
      },
    };

    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Return Demo",
          fileName: "return-demo.json",
          questions: [
            {
              q: "Dönüş sorusu?",
              options: ["A", "B", "C", "D"],
              correct: 0,
              subject: "Genel",
              explanation: "A",
            },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.goto(withStudyShellLaunch(appUrl(), launchPayload));
    await page.locator("#start-btn").click();
    await selectOption(page, 0);

    await expect(page.locator("#mcq-shell-return-link")).toBeVisible();
    await expect(page.locator("#mcq-shell-return-link")).toHaveAttribute(
      "href",
      /studyShellReturn=/,
    );

    const previewPayload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mc_shell_return_preview") || "null"),
    );
    expect(previewPayload).not.toBeNull();
    expect(previewPayload.summary.metrics.correct).toBe(1);
    expect(previewPayload.summary.metrics.answered).toBe(1);
  });

  test("desktop return bridge invokes the native study-shell command", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, payload) => {
          window.__mcqReturnCall = { command, payload };
          return {
            mode: "desktop_executable",
            target: "D:\\apps\\study-shell.exe",
          };
        },
      };
    });

    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "mcq",
      appPath: "apps/mcq",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-mcq-native-return",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Desktop native return mcq",
        durationMinutes: 25,
        notes: "native return",
        preferredFlowId: "mcq",
        activeFlowId: "mcq",
        transitions: [],
      },
    };

    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Native Return Demo",
          fileName: "native-return-demo.json",
          questions: [
            {
              q: "Native dönüş sorusu?",
              options: ["A", "B", "C", "D"],
              correct: 0,
              subject: "Genel",
              explanation: "A",
            },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.goto(withStudyShellLaunch(appUrl(), launchPayload));
    await page.locator("#start-btn").click();
    await selectOption(page, 0);
    await page.locator("#mcq-shell-return-link").click();

    await expect
      .poll(async () =>
        page.evaluate(() => window.__mcqReturnCall?.command || ""),
      )
      .toBe("return_to_study_shell");

    const returnCall = await page.evaluate(() => window.__mcqReturnCall);
    expect(returnCall.payload.request.returnPath).toBe("apps/study-shell");
    expect(returnCall.payload.request.encodedPayload).toContain("%7B");
  });
});
