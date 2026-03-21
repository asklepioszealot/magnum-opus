const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("playwright/test");

function appUrl() {
  const indexPath = path.resolve(process.cwd(), "dist", "index.html");
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

function legacyCardId(question) {
  let h = 0;
  for (let i = 0; i < question.length; i++) {
    h = ((h << 5) - h + question.charCodeAt(i)) | 0;
  }
  return `c${Math.abs(h)}`;
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
        localStorage.setItem(`fc_set_${setId}`, JSON.stringify(setData));
      });
      const loadedSetIds = Object.keys(sets);
      localStorage.setItem("fc_loaded_sets", JSON.stringify(loadedSetIds));
      localStorage.setItem(
        "fc_selected_sets",
        JSON.stringify(selectedSetIds || loadedSetIds),
      );
      if (assessments) {
        localStorage.setItem("fc_assessments", JSON.stringify(assessments));
      }
      if (session) {
        localStorage.setItem("fc_session", JSON.stringify(session));
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

async function loadFixtureAndStart(page) {
  const fixturePath = path.resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "smoke-set.json",
  );

  await clearStorage(page);
  await page.setInputFiles("#file-picker", fixturePath);
  await page.locator("#start-btn").click();
}

async function jumpToCard(page, cardNumber) {
  await page.fill("#jump-input", String(cardNumber));
  await page.press("#jump-input", "Enter");
  await expect(page.locator("#card-counter")).toContainText(`${cardNumber} /`);
}

async function assessCurrentCard(page, level) {
  const flashcard = page.locator("#flashcard");
  const isFlipped = await flashcard.evaluate((node) =>
    node.classList.contains("flipped"),
  );
  if (!isFlipped) {
    await flashcard.click();
  }
  await page.locator(`button.assess-btn.${level}`).click();
  await page.waitForTimeout(550);
}

async function setManagerAutoAdvance(page, enabled) {
  const input = page.locator("#auto-advance-toggle-manager");
  const toggleSwitch = page.locator(".toggle-switch", { has: input });
  const current = await input.isChecked();
  if (current !== enabled) {
    await toggleSwitch.click();
  }
  if (enabled) {
    await expect(input).toBeChecked();
    return;
  }
  await expect(input).not.toBeChecked();
}

test.describe("Flashcards smoke", () => {
  test("set manager flow works from upload to start", async ({ page }) => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests",
      "fixtures",
      "smoke-set.json",
    );

    await clearStorage(page);

    const setManager = page.locator("#set-manager");
    const appContainer = page.locator("#app-container");
    const startButton = page.locator("#start-btn");
    const setManagerHint = setManager.locator(".kbd-hint");

    await expect(setManager).toBeVisible();
    await expect(setManagerHint).toBeVisible();
    await expect(setManagerHint).toContainText("Space");
    const themeToggleSwitch = page
      .locator("#set-manager .toggle-switch")
      .first();
    await expect(themeToggleSwitch).toBeVisible();

    await themeToggleSwitch.click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBe("dark");

    await themeToggleSwitch.click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBeNull();

    await page.setInputFiles("#file-picker", fixturePath);
    await expect(
      page.locator("#set-list .set-title", { hasText: "Smoke Flashcard Set" }),
    ).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(appContainer).toBeVisible();
    await expect(setManager).toBeHidden();
    await expect(appContainer.locator(".kbd-hint")).toHaveCount(0);
  });

  test("subject label is only under the card, not next to the counter", async ({
    page,
  }) => {
    await loadFixtureAndStart(page);

    const navInfo = page.locator(".navigation .card-info");
    await expect(navInfo.locator("#card-counter")).toBeVisible();
    await expect(
      navInfo.locator(".subject-display, .subject-badge, #subject-display-front"),
    ).toHaveCount(0);
    await expect(navInfo).not.toContainText("Genel");

    await expect(page.locator("#subject-display-front")).toBeVisible();
    await expect(page.locator("#subject-display-front")).toHaveText("Genel");
    await expect(page.locator("#card-counter")).toHaveText("1 / 1");
  });

  test("resume exact card after reload", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Resume Demo",
          fileName: "resume-demo.json",
          cards: [
            { q: "Kart A", a: "Cevap A", subject: "Genel" },
            { q: "Kart B", a: "Cevap B", subject: "Genel" },
            { q: "Kart C", a: "Cevap C", subject: "Genel" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await page.locator("#next-btn").click();
    await page.locator("#next-btn").click();
    await expect(page.locator("#card-counter")).toHaveText("3 / 3");
    await expect(page.locator("#question-text")).toHaveText("Kart C");

    await page.reload();
    await page.locator("#start-btn").click();
    await expect(page.locator("#card-counter")).toHaveText("3 / 3");
    await expect(page.locator("#question-text")).toHaveText("Kart C");
  });

  test("assessment persistence without duplicates", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Persistence Demo",
          fileName: "persist-demo.json",
          cards: [
            { q: "Soru A?", a: "Cevap A", subject: "S1" },
            { q: "Soru B?", a: "Cevap B", subject: "S1" },
            { q: "Soru C?", a: "Cevap C", subject: "S2" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await assessCurrentCard(page, "review");

    await page.reload();
    await page.locator("#start-btn").click();

    await jumpToCard(page, 1);
    await expect(page.locator("button.assess-btn.know")).toHaveClass(/selected/);
    await expect(page.locator("button.assess-btn.review")).not.toHaveClass(
      /selected/,
    );

    await jumpToCard(page, 2);
    await expect(page.locator("button.assess-btn.review")).toHaveClass(
      /selected/,
    );
    await expect(page.locator("button.assess-btn.know")).not.toHaveClass(
      /selected/,
    );

    const assessmentSnapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_assessments") || "{}"),
    );
    const setScopedEntries = Object.entries(assessmentSnapshot).filter(([key]) =>
      key.startsWith("set:"),
    );
    expect(
      setScopedEntries.filter(([, value]) => value === "know"),
    ).toHaveLength(1);
    expect(
      setScopedEntries.filter(([, value]) => value === "review"),
    ).toHaveLength(1);
  });

  test("clicking same assessment twice clears the card status", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Toggle Demo",
          fileName: "toggle-demo.json",
          cards: [
            { q: "Soru A?", a: "Cevap A", subject: "S1" },
            { q: "Soru B?", a: "Cevap B", subject: "S1" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");

    await jumpToCard(page, 1);
    await assessCurrentCard(page, "know");

    await expect(page.locator("#card-counter")).toHaveText("1 / 2");
    await expect(page.locator("button.assess-btn.know")).not.toHaveClass(
      /selected/,
    );

    const assessmentSnapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_assessments") || "{}"),
    );
    expect(Object.keys(assessmentSnapshot)).toHaveLength(0);
  });

  test("auto-advance toggle controls navigation and persists after refresh", async ({
    page,
  }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Auto Advance Demo",
          fileName: "auto-advance-demo.json",
          cards: [
            { q: "Kart 1?", a: "Cevap 1", subject: "S1" },
            { q: "Kart 2?", a: "Cevap 2", subject: "S1" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await setManagerAutoAdvance(page, false);
    await expect(page.locator("#auto-advance-status")).toContainText("Kapalı");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("fc_auto_advance")))
      .toBe("0");

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await expect(page.locator("#card-counter")).toHaveText("1 / 2");

    await page.reload();
    await expect(page.locator("#auto-advance-status")).toContainText("Kapalı");
    await setManagerAutoAdvance(page, false);

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "review");
    await expect(page.locator("#card-counter")).toHaveText("1 / 2");

    await page
      .locator("button.btn-small.btn-secondary", { hasText: "Setlere Dön" })
      .click();
    await setManagerAutoAdvance(page, true);
    await expect(page.locator("#auto-advance-status")).toContainText("Açık");
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("fc_auto_advance")))
      .toBe("1");

    await page.locator("#start-btn").click();
    await jumpToCard(page, 1);
    await assessCurrentCard(page, "dunno");
    await expect(page.locator("#card-counter")).toHaveText("2 / 2");
  });

  test("duplicate question across sets is independent", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        "set-a": {
          setName: "Set A",
          fileName: "set-a.json",
          cards: [{ q: "Aynı soru?", a: "Set A cevabı", subject: "A" }],
        },
        "set-b": {
          setName: "Set B",
          fileName: "set-b.json",
          cards: [{ q: "Aynı soru?", a: "Set B cevabı", subject: "B" }],
        },
      },
      selectedSetIds: ["set-a", "set-b"],
    });

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await assessCurrentCard(page, "dunno");

    await page.reload();
    await page.locator("#start-btn").click();

    await jumpToCard(page, 1);
    await expect(page.locator("button.assess-btn.know")).toHaveClass(/selected/);

    await jumpToCard(page, 2);
    await expect(page.locator("button.assess-btn.dunno")).toHaveClass(
      /selected/,
    );

    const assessmentSnapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_assessments") || "{}"),
    );
    const setScopedEntries = Object.entries(assessmentSnapshot).filter(([key]) =>
      key.startsWith("set:"),
    );
    expect(setScopedEntries).toHaveLength(2);
    expect(setScopedEntries.map(([, value]) => value).sort()).toEqual([
      "dunno",
      "know",
    ]);
  });

  test("legacy migration maps question-hash assessments to set-based keys", async ({
    page,
  }) => {
    const legacyQuestion = "Legacy soru?";
    const legacyKey = legacyCardId(legacyQuestion);

    await seedLocalSets(page, {
      sets: {
        legacy: {
          setName: "Legacy Set",
          fileName: "legacy-set.json",
          cards: [{ q: legacyQuestion, a: "Legacy cevap", subject: "Genel" }],
        },
      },
      selectedSetIds: ["legacy"],
      assessments: { [legacyKey]: "review" },
      session: {
        currentCardIndex: 0,
        theme: "light",
        topic: "hepsi",
        activeFilter: "all",
      },
    });

    await page.locator("#start-btn").click();
    await expect(page.locator("button.assess-btn.review")).toHaveClass(
      /selected/,
    );

    const migratedAssessments = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_assessments") || "{}"),
    );
    expect(migratedAssessments["set:legacy::idx:0"]).toBe("review");
  });

  test("legacy state does not overwrite modern assessments on refresh", async ({
    page,
  }) => {
    await seedLocalSets(page, {
      sets: {
        stable: {
          setName: "Stable Set",
          fileName: "stable-set.json",
          cards: [{ q: "Stabil soru?", a: "Cevap", subject: "Genel" }],
        },
      },
      selectedSetIds: ["stable"],
      assessments: { "set:stable::idx:0": "know" },
    });

    await page.evaluate(() => {
      localStorage.setItem(
        "flashcards_state_v6",
        JSON.stringify({ assessments: {} }),
      );
    });

    await page.reload();
    await page.locator("#start-btn").click();
    await expect(page.locator("button.assess-btn.know")).toHaveClass(/selected/);

    const snapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_assessments") || "{}"),
    );
    expect(snapshot["set:stable::idx:0"]).toBe("know");
  });

  test("study shell launch payload is consumed and surfaced in the set manager", async ({
    page,
  }) => {
    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "flashcards",
      appPath: "apps/flashcards",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-flashcards",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Pediatri tekrar turu",
        durationMinutes: 25,
        notes: "Zayif kartlari oncele",
        preferredFlowId: "flashcards",
        activeFlowId: "flashcards",
        transitions: [],
      },
    };

    await page.goto(withStudyShellLaunch(appUrl(), launchPayload));

    await expect(page.locator("#flashcards-shell-launch-banner")).toBeVisible();
    await expect(page.locator("#flashcards-shell-launch-banner")).toContainText(
      "Study Shell oturumu baglandi: Flashcards",
    );
    await expect(page.locator("#flashcards-shell-launch-banner")).toContainText(
      "Pediatri tekrar turu",
    );
    await expect(page.locator("#flashcards-shell-launch-banner")).toContainText(
      "apps/study-shell",
    );

    await expect.poll(async () =>
      page.evaluate(() => window.location.search),
    ).toBe("");

    const storedPayload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_shell_launch") || "null"),
    );
    expect(storedPayload).not.toBeNull();
    expect(storedPayload.flowId).toBe("flashcards");
    expect(storedPayload.session.focus).toBe("Pediatri tekrar turu");
  });

  test("native desktop launch event is consumed without URL navigation", async ({
    page,
  }) => {
    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "flashcards",
      appPath: "apps/flashcards",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-21T01:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-flashcards-native-launch",
        createdAt: "2026-03-21T01:00:00.000Z",
        updatedAt: "2026-03-21T01:00:00.000Z",
        focus: "Native startup event flashcards",
        durationMinutes: 15,
        notes: "no startup navigate",
        preferredFlowId: "flashcards",
        activeFlowId: "flashcards",
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

    await expect(page.locator("#flashcards-shell-launch-banner")).toBeVisible();
    await expect(page.locator("#flashcards-shell-launch-banner")).toContainText(
      "Native startup event flashcards",
    );
    await expect.poll(async () => page.evaluate(() => window.location.search)).toBe(
      "",
    );
  });

  test("study shell return preview updates from flashcard progress", async ({
    page,
  }) => {
    const launchPayload = {
      kind: "study-shell-launch",
      version: 1,
      flowId: "flashcards",
      appPath: "apps/flashcards",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-flashcards-return",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Return loop flashcards",
        durationMinutes: 30,
        notes: "return to shell",
        preferredFlowId: "flashcards",
        activeFlowId: "flashcards",
        transitions: [],
      },
    };

    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Return Demo",
          fileName: "return-demo.json",
          cards: [{ q: "Dönüş kartı?", a: "Cevap", subject: "Genel" }],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.goto(withStudyShellLaunch(appUrl(), launchPayload));
    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");

    await expect(page.locator("#flashcards-shell-return-link")).toBeVisible();
    await expect(page.locator("#flashcards-shell-return-link")).toHaveAttribute(
      "href",
      /studyShellReturn=/,
    );

    const previewPayload = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_shell_return_preview") || "null"),
    );
    expect(previewPayload).not.toBeNull();
    expect(previewPayload.summary.metrics.know).toBe(1);
    expect(previewPayload.summary.metrics.assessed).toBe(1);
  });

  test("desktop return bridge invokes the native study-shell command", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, payload) => {
          window.__flashcardsReturnCall = { command, payload };
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
      flowId: "flashcards",
      appPath: "apps/flashcards",
      returnPath: "apps/study-shell",
      createdAt: "2026-03-20T09:00:00.000Z",
      session: {
        version: 1,
        sessionId: "session-shell-flashcards-native-return",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:00:00.000Z",
        focus: "Desktop native return flashcards",
        durationMinutes: 20,
        notes: "native return",
        preferredFlowId: "flashcards",
        activeFlowId: "flashcards",
        transitions: [],
      },
    };

    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Native Return Demo",
          fileName: "native-return-demo.json",
          cards: [{ q: "Native dönüş kartı?", a: "Cevap", subject: "Genel" }],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.goto(withStudyShellLaunch(appUrl(), launchPayload));
    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await page.locator("#flashcards-shell-return-link").click();

    await expect
      .poll(async () =>
        page.evaluate(() => window.__flashcardsReturnCall?.command || ""),
      )
      .toBe("return_to_study_shell");

    const returnCall = await page.evaluate(() => window.__flashcardsReturnCall);
    expect(returnCall.payload.request.returnPath).toBe("apps/study-shell");
    expect(returnCall.payload.request.encodedPayload).toContain("%7B");
  });
});
