#!/usr/bin/env node
"use strict";

function parseStudyText(content, options = {}) {
  const {
    defaultSetName = "",
    supportsHeadingQuestions = false,
    blockquoteStartsExplanation = false,
  } = options;

  const lines = content.split(/\r?\n/);
  const entries = [];

  let setName = "";
  let canonicalSubject = defaultSetName;
  let currentEntry = null;
  let freeAnswerLines = [];
  let explanationLines = [];
  let awaitingQuestionText = false;
  let collectingExplanation = false;

  function finalizeCurrentEntry() {
    if (!currentEntry) {
      return;
    }

    entries.push({
      prompt: (currentEntry.prompt || "").trim(),
      subject: currentEntry.subject || canonicalSubject,
      options: [...currentEntry.options],
      correctChar: currentEntry.correctChar,
      freeAnswerLines: [...freeAnswerLines],
      explanationLines: [...explanationLines],
    });

    currentEntry = null;
    freeAnswerLines = [];
    explanationLines = [];
    awaitingQuestionText = false;
    collectingExplanation = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.replace(/^\*\*(.*?)\*\*$/, "$1").trim();

    if (/^[-*_]{3,}$/.test(trimmed)) {
      continue;
    }

    const h1Match = normalized.match(/^#\s+(.+)$/);
    if (h1Match) {
      const h1Title = h1Match[1].trim();
      if (!setName) {
        setName = h1Title;
      }
      if (canonicalSubject === defaultSetName) {
        canonicalSubject = h1Title;
      }
      continue;
    }

    const h2Match = normalized.match(/^##\s+(.+)$/);
    if (h2Match) {
      continue;
    }

    const konuMatch = normalized.match(/^#{0,3}\s*Konu:\s*(.+)$/i);
    if (konuMatch) {
      if (currentEntry) {
        currentEntry.subject = konuMatch[1].trim();
      }
      continue;
    }

    const h3Match = supportsHeadingQuestions
      ? normalized.match(/^###\s+(.+)$/)
      : null;
    const inlineQuestionMatch = normalized.match(/^Soru:\s*(.+)$/i);
    const numberedQuestionMatch = normalized.match(
      /^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i,
    );

    if (h3Match || inlineQuestionMatch || numberedQuestionMatch) {
      finalizeCurrentEntry();

      const prompt = (
        h3Match
          ? h3Match[1]
          : inlineQuestionMatch
            ? inlineQuestionMatch[1]
            : numberedQuestionMatch[1] || ""
      ).trim();

      currentEntry = {
        prompt,
        subject: canonicalSubject,
        options: [],
        correctChar: "",
      };

      awaitingQuestionText = prompt.length === 0;
      collectingExplanation = false;
      continue;
    }

    if (awaitingQuestionText && currentEntry) {
      currentEntry.prompt = normalized;
      awaitingQuestionText = false;
      continue;
    }

    const optionMatch = normalized.match(/^([A-Ea-e])[).]\s+(.+)$/);
    if (optionMatch && currentEntry && !collectingExplanation) {
      currentEntry.options.push(optionMatch[2].trim());
      continue;
    }

    const correctMatch = normalized.match(/^Do(?:ğ|g)ru\s*Cevap:\s*([A-Ea-e])\b/i);
    if (correctMatch && currentEntry) {
      currentEntry.correctChar = correctMatch[1].toUpperCase();
      continue;
    }

    const explanationStartMatch = normalized.match(/^(?:Açıklama|Aciklama):\s*(.*)$/i);
    if (explanationStartMatch && currentEntry) {
      collectingExplanation = true;
      explanationLines.push(explanationStartMatch[1]);
      continue;
    }

    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (blockquoteMatch && currentEntry) {
      const canTreatAsExplanation =
        collectingExplanation ||
        blockquoteStartsExplanation ||
        currentEntry.correctChar ||
        currentEntry.options.length > 0;

      if (canTreatAsExplanation) {
        collectingExplanation = true;
        explanationLines.push(blockquoteMatch[1]);
        continue;
      }
    }

    if (currentEntry) {
      if (collectingExplanation) {
        explanationLines.push(line);
      } else {
        freeAnswerLines.push(line);
      }
    }
  }

  finalizeCurrentEntry();

  return {
    setName: setName || defaultSetName,
    canonicalSubject,
    entries,
  };
}

module.exports = {
  parseStudyText,
};
