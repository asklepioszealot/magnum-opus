      // --- YENİ SET YÖNETİMİ DEĞİŞKENLERİ ---
      let loadedSets = {};
      let selectedSets = new Set();
      let removeCandidateSets = new Set();
      let deleteMode = false;
      let lastRemovedSets = [];
      let undoTimeoutId = null;

      // --- ESKİ DEĞİŞKENLER ---
      let currentQuestionIndex = 0;
      let allQuestions = [];
      let filteredQuestions = [];
      let questionOrder = [];
      let selectedAnswers = {};
      let solutionVisible = {};
      let pendingSession = null;
      const storage = window.AppStorage;

      function buildQuestionKey(setId, question, index) {
        const normalizedSetId = String(setId ?? "unknown");
        const questionIdValue =
          question && question.id !== undefined && question.id !== null
            ? String(question.id).trim()
            : "";
        if (questionIdValue.length > 0) {
          return `set:${normalizedSetId}::id:${questionIdValue}`;
        }
        return `set:${normalizedSetId}::idx:${index}`;
      }

      function legacyCardId(q) {
        let hash = 0;
        const questionText = q && typeof q.q === "string" ? q.q : "";
        const questionSubject =
          q && typeof q.subject === "string" ? q.subject : "";
        const text = questionText + questionSubject;
        for (let i = 0; i < text.length; i++) {
          const char = text.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash;
        }
        return "mc_" + hash;
      }

      function cardId(q, fallbackSetId, fallbackIndex) {
        if (q && typeof q.__questionKey === "string" && q.__questionKey.length > 0) {
          return q.__questionKey;
        }
        if (typeof fallbackSetId === "string" && Number.isInteger(fallbackIndex)) {
          return buildQuestionKey(fallbackSetId, q, fallbackIndex);
        }
        if (q && typeof q.__setId === "string" && Number.isInteger(q.__setIndex)) {
          return buildQuestionKey(q.__setId, q, q.__setIndex);
        }
        return legacyCardId(q);
      }

      function getExplanationHtml(question) {
        if (
          question &&
          typeof question.explanation === "string" &&
          question.explanation.trim()
        ) {
          return question.explanation;
        }
        return '<span class="highlight-important">⚠️ Açıklama bulunamadı.</span>';
      }

      function parseMarkdownToJSON(content, fileName) {
        const lines = content.split("\n");
        const fileStem = (fileName || "set").replace(/\.[^/.]+$/, "");
        const result = {
          setName: fileStem,
          questions: [],
        };

        let currentQuestion = null;
        let canonicalSubject = fileStem;
        let capturingExplanation = false;
        let explanationLines = [];
        let awaitingQuestionText = false;

        function processFormatting(text) {
          return text
            .replace(
              /==([^=]+)==/g,
              '<strong class="highlight-critical">$1</strong>',
            )
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>")
            .replace(
              /^(?:> )?⚠️(.*)$/gm,
              '<span class="highlight-important">⚠️$1</span>',
            );
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const normalizedLine = line.replace(/^\*\*(.*?)\*\*$/, "$1").trim();

          const h1Match = normalizedLine.match(/^#\s+(.+)$/);
          if (h1Match) {
            const h1Title = h1Match[1].trim();
            if (canonicalSubject === fileStem) {
              result.setName = h1Title;
              canonicalSubject = h1Title;
            }
            continue;
          }

          const h2Match = normalizedLine.match(/^##\s+(.+)$/);
          if (h2Match) {
            continue;
          }

          if (/^[-*_]{3,}$/.test(normalizedLine)) {
            continue;
          }

          const konuMatch = normalizedLine.match(/^#{0,3}\s*Konu:\s*(.+)$/i);
          if (konuMatch) {
            if (currentQuestion) currentQuestion.subject = konuMatch[1].trim();
            continue;
          }

          const soruInlineMatch = normalizedLine.match(/^Soru:\s*(.+)$/i);
          const soruNumberedMatch = normalizedLine.match(
            /^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i,
          );

          if (soruInlineMatch || soruNumberedMatch) {
            if (currentQuestion) {
              if (capturingExplanation) {
                currentQuestion.explanation = explanationLines
                  .join("<br>")
                  .trim();
              }
              result.questions.push(currentQuestion);
            }

            const qText = (soruInlineMatch
              ? soruInlineMatch[1]
              : soruNumberedMatch[1] || ""
            ).trim();

            currentQuestion = {
              q: processFormatting(qText),
              options: [],
              correct: -1,
              explanation: "",
              subject: canonicalSubject,
            };
            capturingExplanation = false;
            explanationLines = [];
            awaitingQuestionText = qText.length === 0;
            continue;
          }

          if (awaitingQuestionText && currentQuestion) {
            currentQuestion.q = processFormatting(normalizedLine);
            awaitingQuestionText = false;
            continue;
          }

          const optionMatch = normalizedLine.match(/^([A-Ea-e])[).]\s+(.+)$/);
          if (optionMatch && currentQuestion && !capturingExplanation) {
            currentQuestion.options.push(
              processFormatting(optionMatch[2].trim()),
            );
            continue;
          }

          const correctMatch = normalizedLine.match(
            /^Do(?:ğ|g)ru\s*Cevap:\s*([A-Ea-e])\b/i,
          );
          if (correctMatch) {
            const correctChar = correctMatch[1].toUpperCase();
            if (currentQuestion) {
              currentQuestion.correct = correctChar.charCodeAt(0) - 65;
            }
            continue;
          }

          const explanationStartMatch = normalizedLine.match(
            /^(?:Açıklama|Aciklama):\s*(.*)$/i,
          );
          if (explanationStartMatch) {
            capturingExplanation = true;
            let expText = explanationStartMatch[1].trim();
            explanationLines.push(processFormatting(expText));
            continue;
          }

          const blockquoteMatch = line.match(/^>\s?(.*)$/);
          if (blockquoteMatch && currentQuestion) {
            capturingExplanation = true;
            explanationLines.push(processFormatting(blockquoteMatch[1].trim()));
            continue;
          }

          if (capturingExplanation) {
            explanationLines.push(processFormatting(normalizedLine));
          }
        }

        if (currentQuestion) {
          if (capturingExplanation) {
            currentQuestion.explanation = explanationLines.join("<br>").trim();
          }
          result.questions.push(currentQuestion);
        }

        return result;
      }

      async function handleFileSelect(event) {
        const files = event.target.files;
        for (const file of files) {
          try {
            const text = await file.text();
            let data;

            if (file.name.endsWith(".md") || file.name.endsWith(".txt")) {
              data = parseMarkdownToJSON(text, file.name);
            } else {
              // JSON'daki sondaki virgülleri (trailing commas) temizle
              const cleanText = text.replace(/,\s*([\]}])/g, "$1");
              data = JSON.parse(cleanText);
            }

            const setId = file.name.replace(/\.[^/.]+$/, "");
            const normalizedQuestions = Array.isArray(data.questions)
              ? data.questions
                  .filter(
                    (question) =>
                      question &&
                      typeof question === "object" &&
                      !Array.isArray(question),
                  )
                  .map((question) => ({
                    q: typeof question.q === "string" ? question.q : "",
                    options: Array.isArray(question.options)
                      ? question.options.filter((option) => typeof option === "string")
                      : [],
                    correct: Number.isInteger(question.correct)
                      ? question.correct
                      : -1,
                    explanation:
                      typeof question.explanation === "string"
                        ? question.explanation
                        : "",
                    subject:
                      typeof question.subject === "string" && question.subject.trim()
                        ? question.subject
                        : "Genel",
                    id:
                      typeof question.id === "string" ||
                      typeof question.id === "number"
                        ? question.id
                        : null,
                  }))
              : [];

            loadedSets[setId] = {
              setName: data.setName || file.name,
              questions: normalizedQuestions,
              fileName: file.name,
            };

            saveSetsList();
            storage.setItem(
              "mc_set_" + setId,
              JSON.stringify(loadedSets[setId]),
            );
          } catch (e) {
            console.error("Set okuma hatası:", e);
            alert(file.name + " okunamadı. Dosya formatı uyumlu değil.");
          }
        }

        Object.keys(loadedSets).forEach((id) => selectedSets.add(id));
        renderSetList();
      }

      function saveSetsList() {
        storage.setItem(
          "mc_loaded_sets",
          JSON.stringify(Object.keys(loadedSets)),
        );
        storage.setItem(
          "mc_selected_sets",
          JSON.stringify([...selectedSets]),
        );
      }

      function renderSetList() {
        const setListEl = document.getElementById("set-list");
        const startBtn = document.getElementById("start-btn");
        const setToolsEl = document.getElementById("set-list-tools");
        const removeSelectedBtn = document.getElementById("remove-selected-btn");
        const deleteModeBtn = document.getElementById("delete-mode-btn");
        const selectAllBtn = document.getElementById("select-all-btn");
        const clearSelectionBtn = document.getElementById("clear-selection-btn");
        const modeHint = document.getElementById("mode-hint");

        if (Object.keys(loadedSets).length === 0) {
          setListEl.innerHTML =
            '<div class="set-empty">Henüz test seti yüklenmedi.<br>Aşağıdaki butondan JSON dosyası yükleyin.</div>';
          startBtn.disabled = true;
          setToolsEl.style.display = "none";
          if (removeSelectedBtn) removeSelectedBtn.disabled = true;
          return;
        }

        startBtn.disabled = selectedSets.size === 0;
        setToolsEl.style.display = "flex";
        if (deleteModeBtn) {
          deleteModeBtn.textContent = deleteMode
            ? "Silme Modu: Açık"
            : "Silme Modu: Kapalı";
          deleteModeBtn.className = deleteMode
            ? "btn btn-small btn-danger"
            : "btn btn-small btn-secondary";
        }
        if (selectAllBtn) {
          selectAllBtn.textContent = deleteMode
            ? "Silineceklerin Tümünü Seç"
            : "Tümünü Derse Dahil Et";
        }
        if (clearSelectionBtn) {
          clearSelectionBtn.textContent = deleteMode
            ? "Silme Seçimini Temizle"
            : "Ders Seçimini Temizle";
        }
        if (modeHint) {
          modeHint.textContent = deleteMode
            ? "Mod: Sileceğin setleri işaretliyorsun."
            : "Mod: Derse dahil edilecek setleri seçiyorsun.";
        }
        if (removeSelectedBtn) {
          removeSelectedBtn.disabled = !deleteMode || removeCandidateSets.size === 0;
          removeSelectedBtn.textContent = `Seçilileri Kaldır (${removeCandidateSets.size})`;
        }
        setListEl.innerHTML = "";

        for (const [setId, setObj] of Object.entries(loadedSets)) {
          const isSelected = deleteMode
            ? removeCandidateSets.has(setId)
            : selectedSets.has(setId);

          let solvedCount = 0;
          let correctCount = 0;
          let wrongCount = 0;
          const totalQuestions = Array.isArray(setObj.questions)
            ? setObj.questions.length
            : 0;

          setObj.questions.forEach((q, index) => {
            const questionKey = cardId(q, setId, index);
            if (selectedAnswers[questionKey] !== undefined) {
              solvedCount++;
              if (selectedAnswers[questionKey] === q.correct) {
                correctCount++;
              } else {
                wrongCount++;
              }
            }
          });

          const progressPercent =
            totalQuestions > 0
              ? Math.round((solvedCount / totalQuestions) * 100)
              : 0;

          const markup = `
            <div class="set-item">
              <div class="set-item-left" onclick="toggleSetCheck('${setId}')">
                <input type="checkbox" ${isSelected ? "checked" : ""} onclick="event.stopPropagation(); toggleSetCheck('${setId}')">
                <div class="set-info">
                  <div class="set-name">${setObj.setName}</div>
                  <div class="set-stats">📚 ${totalQuestions} Soru | 📊 İlerleme: ${solvedCount}/${totalQuestions} (%${progressPercent}) | ✅ ${correctCount} ❌ ${wrongCount}</div>
                </div>
              </div>
              <button class="delete-btn-circle" title="Seti kaldır" onclick="deleteSet('${setId}')">-</button>
            </div>
          `;
          setListEl.innerHTML += markup;
        }
      }

      function toggleSetCheck(setId) {
        if (deleteMode) {
          if (removeCandidateSets.has(setId)) {
            removeCandidateSets.delete(setId);
          } else {
            removeCandidateSets.add(setId);
          }
          renderSetList();
          return;
        }
        toggleSetSelection(setId);
      }

      function toggleSetSelection(setId) {
        if (selectedSets.has(setId)) {
          selectedSets.delete(setId);
        } else {
          selectedSets.add(setId);
        }
        saveSetsList();
        renderSetList();
      }

      function deleteSet(setId) {
        removeSets([setId]);
      }

      function removeSets(idsToRemove) {
        const removed = [];
        idsToRemove.forEach((setId) => {
          if (!loadedSets[setId]) return;
          removed.push({
            setId: setId,
            setData: loadedSets[setId],
            wasSelected: selectedSets.has(setId),
          });
          delete loadedSets[setId];
          selectedSets.delete(setId);
          removeCandidateSets.delete(setId);
          storage.removeItem("mc_set_" + setId);
        });
        if (removed.length === 0) return;
        lastRemovedSets = removed;
        showUndoToast(
          removed.length === 1
            ? "Set kaldırıldı."
            : `${removed.length} set kaldırıldı.`,
        );
        saveSetsList();
        renderSetList();
      }

      function selectAllSets() {
        if (deleteMode) {
          removeCandidateSets = new Set(Object.keys(loadedSets));
          renderSetList();
          return;
        }
        selectedSets = new Set(Object.keys(loadedSets));
        saveSetsList();
        renderSetList();
      }

      function clearSetSelection() {
        if (deleteMode) {
          removeCandidateSets.clear();
          renderSetList();
          return;
        }
        selectedSets.clear();
        saveSetsList();
        renderSetList();
      }

      function removeSelectedSets() {
        if (!deleteMode || removeCandidateSets.size === 0) return;
        removeSets([...removeCandidateSets]);
      }

      function toggleDeleteMode() {
        deleteMode = !deleteMode;
        if (!deleteMode) {
          removeCandidateSets.clear();
        }
        renderSetList();
      }

      function showUndoToast(message) {
        const toast = document.getElementById("undo-toast");
        const msgEl = document.getElementById("undo-message");
        if (!toast || !msgEl) return;
        msgEl.textContent = message;
        toast.style.display = "flex";
        if (undoTimeoutId) {
          clearTimeout(undoTimeoutId);
        }
        undoTimeoutId = setTimeout(() => {
          toast.style.display = "none";
          lastRemovedSets = [];
        }, 7000);
      }

      function undoLastRemoval() {
        if (!lastRemovedSets || lastRemovedSets.length === 0) return;
        lastRemovedSets.forEach((entry) => {
          loadedSets[entry.setId] = entry.setData;
          storage.setItem("mc_set_" + entry.setId, JSON.stringify(entry.setData));
          if (entry.wasSelected) {
            selectedSets.add(entry.setId);
          }
        });
        const toast = document.getElementById("undo-toast");
        if (toast) toast.style.display = "none";
        if (undoTimeoutId) {
          clearTimeout(undoTimeoutId);
          undoTimeoutId = null;
        }
        removeCandidateSets.clear();
        lastRemovedSets = [];
        saveSetsList();
        renderSetList();
      }

      function startStudy() {
        if (selectedSets.size === 0) return;

        allQuestions = [];
        for (const setId of selectedSets) {
          const setData = loadedSets[setId];
          if (!setData || !Array.isArray(setData.questions)) continue;
          setData.questions.forEach((question, index) => {
            const clonedQuestion = { ...question };
            clonedQuestion.__setId = setId;
            clonedQuestion.__setIndex = index;
            clonedQuestion.__questionKey = buildQuestionKey(setId, question, index);
            allQuestions.push(clonedQuestion);
          });
        }

        if (allQuestions.length === 0) {
          alert("Seçili setlerde soru bulunamadı.");
          return;
        }

        filteredQuestions = [...allQuestions];
        questionOrder = [...Array(filteredQuestions.length).keys()];
        currentQuestionIndex = 0;

        document.getElementById("set-manager").style.display = "none";
        document.getElementById("main-app").style.display = "block";

        populateTopicFilter();
        updateScoreDisplay();

        const session = pendingSession || {};
        const topicSelect = document.getElementById("topic-select");
        if (
          topicSelect &&
          typeof session.selectedTopic === "string" &&
          [...topicSelect.options].some(
            (option) => option.value === session.selectedTopic,
          )
        ) {
          topicSelect.value = session.selectedTopic;
        }

        filterByTopic(false, {
          preferredQuestionKey:
            session && typeof session.currentQuestionKey === "string"
              ? session.currentQuestionKey
              : null,
          fallbackIndex:
            session && Number.isInteger(session.currentQuestionIndex)
              ? session.currentQuestionIndex
              : null,
        });
      }

      function showSetManager() {
        document.getElementById("set-manager").style.display = "block";
        document.getElementById("main-app").style.display = "none";
        renderSetList();
      }

      function filterByTopic(resetIndex = true, options = {}) {
        const selectedTopic = document.getElementById("topic-select").value;

        if (selectedTopic === "hepsi") {
          filteredQuestions = [...allQuestions];
        } else {
          filteredQuestions = allQuestions.filter(
            (q) => q.subject === selectedTopic,
          );
        }

        questionOrder = [...Array(filteredQuestions.length).keys()];

        let restoredIndex = 0;
        if (resetIndex) {
          currentQuestionIndex = 0;
        } else {
          const preferredQuestionKey = options.preferredQuestionKey;
          const fallbackIndex = Number.isInteger(options.fallbackIndex)
            ? options.fallbackIndex
            : null;

          if (
            typeof preferredQuestionKey === "string" &&
            preferredQuestionKey.length > 0
          ) {
            const matchedIndex = questionOrder.findIndex((questionIndex) => {
              const question = filteredQuestions[questionIndex];
              return cardId(question) === preferredQuestionKey;
            });
            if (matchedIndex >= 0) {
              restoredIndex = matchedIndex;
            } else if (fallbackIndex !== null) {
              restoredIndex = Math.min(
                Math.max(fallbackIndex, 0),
                Math.max(filteredQuestions.length - 1, 0),
              );
            }
          } else if (fallbackIndex !== null) {
            restoredIndex = Math.min(
              Math.max(fallbackIndex, 0),
              Math.max(filteredQuestions.length - 1, 0),
            );
          }
        }
        if (!resetIndex) {
          currentQuestionIndex = restoredIndex;
        }

        document
          .getElementById("jump-input")
          .setAttribute("max", filteredQuestions.length);

        if (filteredQuestions.length > 0) {
          displayQuestion();
          return;
        }

        document.getElementById("question-text").innerHTML =
          "Bu filtrede gösterilecek soru bulunamadı.";
        document.getElementById("question-counter").textContent = "Soru 0 / 0";
        document.getElementById("subject-badge").textContent = selectedTopic;
        document.getElementById("solution-content").innerHTML = "";
        document.getElementById("options-container").innerHTML = "";
        document.getElementById("solution").classList.remove("visible");
        document.getElementById("show-solution-btn").textContent = "Çözümü Göster";
        document.getElementById("prev-btn").disabled = true;
        document.getElementById("next-btn").disabled = true;
        saveState();
      }

      function displayQuestion() {
        const q = filteredQuestions[questionOrder[currentQuestionIndex]];
        const cid = cardId(q);

        document.getElementById("question-text").innerHTML = q.q;
        document.getElementById("question-counter").textContent =
          `Soru ${currentQuestionIndex + 1} / ${filteredQuestions.length}`;
        document.getElementById("subject-badge").textContent = q.subject;
        document.getElementById("solution-content").innerHTML =
          getExplanationHtml(q).replace(/<br>/g, "<br>");

        const optionsContainer = document.getElementById("options-container");
        optionsContainer.innerHTML = "";

        q.options.forEach((option, index) => {
          const optionDiv = document.createElement("div");
          optionDiv.className = "option";
          optionDiv.innerHTML = `<span class="option-label">${String.fromCharCode(65 + index)}</span><span>${option}</span>`;

          if (
            selectedAnswers[cid] !== undefined &&
            selectedAnswers[cid] !== null
          ) {
            if (index === q.correct) {
              optionDiv.classList.add("correct");
            } else if (index === selectedAnswers[cid]) {
              optionDiv.classList.add("wrong");
            }
          } else if (selectedAnswers[cid] === index) {
            optionDiv.classList.add("selected");
          }

          optionDiv.onclick = () => selectOption(index);
          optionsContainer.appendChild(optionDiv);
        });

        const solution = document.getElementById("solution");
        if (solutionVisible[cid]) {
          solution.classList.add("visible");
          document.getElementById("show-solution-btn").textContent =
            "Çözümü Gizle";
        } else {
          solution.classList.remove("visible");
          document.getElementById("show-solution-btn").textContent =
            "Çözümü Göster";
        }

        document.getElementById("prev-btn").disabled =
          currentQuestionIndex === 0;
        document.getElementById("next-btn").disabled =
          currentQuestionIndex === filteredQuestions.length - 1;
        saveState();
      }

      function selectOption(index) {
        const q = filteredQuestions[questionOrder[currentQuestionIndex]];
        const cid = cardId(q);

        selectedAnswers[cid] = index;

        const options = document.querySelectorAll(".option");
        options.forEach((opt, i) => {
          opt.classList.remove("selected", "correct", "wrong");

          if (i === q.correct) {
            opt.classList.add("correct");
          } else if (i === index && i !== q.correct) {
            opt.classList.add("wrong");
          }
        });
        saveState();
        updateScoreDisplay();
      }

      function toggleSolution() {
        const q = filteredQuestions[questionOrder[currentQuestionIndex]];
        const cid = cardId(q);
        solutionVisible[cid] = !solutionVisible[cid];

        const solution = document.getElementById("solution");
        const btn = document.getElementById("show-solution-btn");

        if (solutionVisible[cid]) {
          solution.classList.add("visible");
          btn.textContent = "Çözümü Gizle";
        } else {
          solution.classList.remove("visible");
          btn.textContent = "Çözümü Göster";
        }
        saveState();
      }

      function previousQuestion() {
        if (currentQuestionIndex > 0) {
          currentQuestionIndex--;
          displayQuestion();
        }
      }

      function nextQuestion() {
        if (currentQuestionIndex < filteredQuestions.length - 1) {
          currentQuestionIndex++;
          displayQuestion();
        }
      }

      function jumpToQuestion() {
        const input = document.getElementById("jump-input");
        const questionNum = parseInt(input.value);

        if (questionNum >= 1 && questionNum <= filteredQuestions.length) {
          currentQuestionIndex = questionNum - 1;
          displayQuestion();
          input.value = "";
        } else {
          alert(
            `Lütfen 1 ile ${filteredQuestions.length} arasında bir sayı girin.`,
          );
        }
      }

      document
        .getElementById("jump-input")
        .addEventListener("keypress", function (e) {
          if (e.key === "Enter") {
            jumpToQuestion();
          }
        });

      document
        .getElementById("jump-input")
        .setAttribute("max", filteredQuestions.length);

      function toggleTheme(isChecked) {
        window.ThemeManager.toggleTheme({
          isChecked: isChecked,
          primaryToggleId: "theme-toggle",
          managerToggleId: "theme-toggle-manager",
          storageApi: storage,
          storageKey: "quiz-theme",
        });
      }

      function shuffleQuestions() {
        if (filteredQuestions.length === 0) return;

        for (let i = questionOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [questionOrder[i], questionOrder[j]] = [
            questionOrder[j],
            questionOrder[i],
          ];
        }
        currentQuestionIndex = 0;
        displayQuestion();
      }

      function exportPrintable() {
        const printWindow = window.open("", "_blank");
        let html =
          '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Çoktan Seçmeli Test - Test Çıktısı</title>';
        html += "<style>";
        html +=
          'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #21302a; line-height: 1.6; }';
        html +=
          ".question { margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; page-break-inside: avoid; }";
        html +=
          ".q-num { font-weight: 700; color: #2f7a56; margin-bottom: 8px; }";
        html += ".q-text { font-size: 16px; margin-bottom: 12px; }";
        html += ".option { padding: 4px 0; }";
        html += ".option.correct { color: #059669; font-weight: 600; }";
        html +=
          ".explanation { margin-top: 12px; padding: 12px; background: #f0fdf4; border-radius: 6px; font-size: 14px; border-left: 3px solid #2f7a56; }";
        html += "h1 { text-align: center; color: #2f7a56; }";
        html += "@media print { .question { border: 1px solid #ccc; } }";
        html += "</style></head><body><h1>Çoktan Seçmeli Test</h1>";

        allQuestions.forEach((q, i) => {
          const labels = ["A", "B", "C", "D", "E"];
          html += '<div class="question">';
          html +=
            '<div class="q-num">Soru ' + (i + 1) + " - " + q.subject + "</div>";
          html += '<div class="q-text">' + q.q + "</div>";
          q.options.forEach((opt, j) => {
            const isCorrect = j === q.correct;
            html +=
              '<div class="option' +
              (isCorrect ? " correct" : "") +
              '">' +
              labels[j] +
              ") " +
              opt +
              (isCorrect ? " ✓" : "") +
              "</div>";
          });
          html +=
            '<div class="explanation">' +
            getExplanationHtml(q).replace(/<br>/g, "<br>") +
            "</div>";
          html += "</div>";
        });

        html += "</body></html>";
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
      }

      function retryWrongAnswers() {
        const wrongQuestions = allQuestions.filter((q, i) => {
          const cid = cardId(q);
          return (
            selectedAnswers[cid] !== undefined &&
            selectedAnswers[cid] !== q.correct
          );
        });

        if (wrongQuestions.length === 0) {
          alert("Yanlış cevaplanan soru bulunamadı. Önce soruları cevaplayın.");
          return;
        }

        filteredQuestions = wrongQuestions;
        wrongQuestions.forEach((q) => {
          const cid = cardId(q);
          delete selectedAnswers[cid];
          delete solutionVisible[cid];
        });

        questionOrder = [...Array(filteredQuestions.length).keys()];
        currentQuestionIndex = 0;
        document.getElementById("topic-select").value = "hepsi";
        document
          .getElementById("jump-input")
          .setAttribute("max", filteredQuestions.length);
        saveState();
        updateScoreDisplay();
        displayQuestion();
      }

      function resetQuiz() {
        if (
          !confirm(
            "Tüm cevaplarınız ve ilerlemeniz sıfırlanacak. Emin misiniz?",
          )
        )
          return;

        // Sadece mevcut sorulardaki cevapları sil (diğer setleri etkileme)
        allQuestions.forEach((q) => {
          const cid = cardId(q);
          delete selectedAnswers[cid];
          delete solutionVisible[cid];
        });

        currentQuestionIndex = 0;
        filteredQuestions = [...allQuestions];
        questionOrder = [...Array(filteredQuestions.length).keys()];
        document.getElementById("topic-select").value = "hepsi";

        const jumpInput = document.getElementById("jump-input");
        if (jumpInput) jumpInput.setAttribute("max", filteredQuestions.length);

        saveState();
        updateScoreDisplay();
        displayQuestion();
      }

      function updateScoreDisplay() {
        let correct = 0;
        let wrong = 0;
        let answered = 0;

        allQuestions.forEach((q) => {
          const cid = cardId(q);
          if (selectedAnswers[cid] !== undefined) {
            answered++;
            if (selectedAnswers[cid] === q.correct) {
              correct++;
            } else {
              wrong++;
            }
          }
        });

      const scoreEl = document.getElementById("score-display");
        if (!scoreEl) return;
        if (answered === 0) {
          scoreEl.textContent = "";
          return;
        }
        const progressPct =
          allQuestions.length > 0
            ? Math.round((answered / allQuestions.length) * 100)
            : 0;
        const accuracyPct = Math.round((correct / answered) * 100);
        scoreEl.innerHTML =
          "✅ " +
          correct +
          " &nbsp; ❌ " +
          wrong +
          " &nbsp; 📊 " +
          answered +
          "/" +
          allQuestions.length +
          " (%" +
          progressPct +
          ")" +
          " &nbsp; 🎯 %" +
          accuracyPct;
      }

      function migrateLegacyAssessmentsIfNeeded() {
        const legacyToModernMap = new Map();
        Object.entries(loadedSets).forEach(([setId, setObj]) => {
          if (!setObj || !Array.isArray(setObj.questions)) return;
          setObj.questions.forEach((question, index) => {
            const legacyKey = legacyCardId(question);
            const modernKey = buildQuestionKey(setId, question, index);
            if (!legacyToModernMap.has(legacyKey)) {
              legacyToModernMap.set(legacyKey, new Set());
            }
            legacyToModernMap.get(legacyKey).add(modernKey);
          });
        });

        const migrateMap = (sourceMap) => {
          const normalizedMap =
            sourceMap && typeof sourceMap === "object" && !Array.isArray(sourceMap)
              ? sourceMap
              : {};
          const migratedMap = { ...normalizedMap };
          let changed = false;

          Object.entries(normalizedMap).forEach(([key, value]) => {
            if (typeof key !== "string" || key.startsWith("set:")) return;
            const matches = legacyToModernMap.get(key);
            if (!matches || matches.size === 0) return;
            changed = true;
            matches.forEach((modernKey) => {
              if (!(modernKey in migratedMap)) {
                migratedMap[modernKey] = value;
              }
            });
          });

          return { migratedMap, changed };
        };

        const selectedAnswersMigration = migrateMap(selectedAnswers);
        const solutionVisibleMigration = migrateMap(solutionVisible);
        if (selectedAnswersMigration.changed) {
          selectedAnswers = selectedAnswersMigration.migratedMap;
        }
        if (solutionVisibleMigration.changed) {
          solutionVisible = solutionVisibleMigration.migratedMap;
        }
        return (
          selectedAnswersMigration.changed || solutionVisibleMigration.changed
        );
      }

      function saveState() {
        try {
          const activeQuestion =
            filteredQuestions.length > 0
              ? filteredQuestions[questionOrder[currentQuestionIndex]]
              : null;
          const topicSelect = document.getElementById("topic-select");
          const sessionState = {
            currentQuestionIndex: currentQuestionIndex,
            currentQuestionKey: activeQuestion ? cardId(activeQuestion) : null,
            selectedTopic: topicSelect ? topicSelect.value : "hepsi",
          };
          storage.setItem("mc_session", JSON.stringify(sessionState));

          const assessmentState = {
            selectedAnswers: selectedAnswers,
            solutionVisible: solutionVisible,
          };
          storage.setItem(
            "mc_assessments",
            JSON.stringify(assessmentState),
          );
        } catch (e) {
          console.error("State saving error", e);
        }
      }

      function loadState() {
        try {
          window.ThemeManager.initThemeFromStorage({
            primaryToggleId: "theme-toggle",
            managerToggleId: "theme-toggle-manager",
            storageApi: storage,
            storageKey: "quiz-theme",
          });

          const savedAssessments = storage.getItem("mc_assessments");
          if (savedAssessments) {
            const state = JSON.parse(savedAssessments);
            selectedAnswers =
              state && typeof state.selectedAnswers === "object"
                ? state.selectedAnswers
                : {};
            solutionVisible =
              state && typeof state.solutionVisible === "object"
                ? state.solutionVisible
                : {};
          }

          const savedSession = storage.getItem("mc_session");
          pendingSession = null;
          if (savedSession) {
            const session = JSON.parse(savedSession);
            if (session && typeof session === "object") {
              pendingSession = session;
            }
          }

          if (migrateLegacyAssessmentsIfNeeded()) {
            storage.setItem(
              "mc_assessments",
              JSON.stringify({
                selectedAnswers: selectedAnswers,
                solutionVisible: solutionVisible,
              }),
            );
          }
        } catch (e) {
          console.error("State loading error", e);
        }
      }

      function populateTopicFilter() {
        const select = document.getElementById("topic-select");
        if (!select) return;
        const subjects = [...new Set(allQuestions.map((q) => q.subject))];
        select.innerHTML = '<option value="hepsi">Tüm Başlıklar</option>';
        subjects.forEach((subject) => {
          const option = document.createElement("option");
          option.value = subject;
          option.textContent = subject;
          select.appendChild(option);
        });
      }

      // -- BAŞLATMA MANTIĞI --
      document.addEventListener("keydown", function (e) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")
          return;

        // Yalnızca main-app görünürse tuşlara izin ver
        if (document.getElementById("main-app").style.display === "none")
          return;

        if (e.key === "ArrowLeft") {
          previousQuestion();
        } else if (e.key === "ArrowRight") {
          nextQuestion();
        } else if (e.key === "s" || e.key === "S") {
          toggleSolution();
        } else if (e.key >= "a" && e.key <= "e") {
          selectOption(e.key.charCodeAt(0) - 97);
        } else if (e.key >= "A" && e.key <= "E") {
          selectOption(e.key.charCodeAt(0) - 65);
        }
      });

      // İlk yüklendiğinde set listesini localStorage'dan getir
      function initApp() {
        try {
          const storedSets = storage.getItem("mc_loaded_sets");
          const storedSelected = storage.getItem("mc_selected_sets");

          if (storedSets) {
            const setIds = JSON.parse(storedSets);
            setIds.forEach((id) => {
              const setData = storage.getItem("mc_set_" + id);
              if (setData) {
                loadedSets[id] = JSON.parse(setData);
              }
            });
          }

          if (storedSelected) {
            const selArray = JSON.parse(storedSelected);
            selectedSets = new Set(selArray.filter((id) => loadedSets[id]));
          }
        } catch (e) {
          console.error("Cache load error", e);
        }

        loadState();
        renderSetList();
      }

      initApp();
