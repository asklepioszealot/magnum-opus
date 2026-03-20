#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUPPORTED_EXTENSIONS = new Set([".json", ".md"]);
const REQUIRE_FILES_FLAG = "--require-files";

function parseCliArgs(rawArgs) {
  const inputTargets = [];
  let requireFiles = false;

  for (const arg of rawArgs) {
    if (arg === REQUIRE_FILES_FLAG) {
      requireFiles = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option: ${arg}. Supported options: ${REQUIRE_FILES_FLAG}`,
      );
    }

    inputTargets.push(path.resolve(arg));
  }

  return {
    requireFiles,
    usedDefaultTarget: inputTargets.length === 0,
    inputTargets:
      inputTargets.length > 0 ? inputTargets : [path.resolve("data")],
  };
}

function collectSetFiles(inputPaths, options = {}) {
  const resolvedFiles = [];
  const seen = new Set();
  const allowMissingPaths = options.allowMissingPaths || new Set();

  function walk(targetPath) {
    if (!fs.existsSync(targetPath)) {
      if (allowMissingPaths.has(path.resolve(targetPath))) {
        return;
      }

      throw new Error(`Path not found: ${targetPath}`);
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(targetPath)) {
        walk(path.join(targetPath, entry));
      }
      return;
    }

    const extension = path.extname(targetPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return;
    }

    const normalized = path.resolve(targetPath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      resolvedFiles.push(normalized);
    }
  }

  inputPaths.forEach(walk);
  return resolvedFiles.sort((a, b) => a.localeCompare(b));
}

function normalizeQuestionText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[*_`>#~[\](){}|\\]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function questionHash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function parseMarkdownQuestions(content) {
  const lines = content.split(/\r?\n/);
  const questions = [];
  let awaitingQuestionText = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.replace(/^\*\*(.*?)\*\*$/, "$1").trim();
    const h3Match = normalized.match(/^###\s+(.+)$/);
    const inlineMatch = normalized.match(/^Soru:\s*(.+)$/i);
    const numberedMatch = normalized.match(
      /^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i,
    );

    if (h3Match || inlineMatch || numberedMatch) {
      const questionText = (
        h3Match ? h3Match[1] : inlineMatch ? inlineMatch[1] : numberedMatch[1] || ""
      ).trim();

      if (questionText) {
        questions.push(questionText);
        awaitingQuestionText = false;
      } else {
        awaitingQuestionText = true;
      }
      continue;
    }

    if (awaitingQuestionText) {
      questions.push(normalized);
      awaitingQuestionText = false;
    }
  }

  return questions;
}

function validateMcqJson(setJson, filePath, errors) {
  const questions = setJson.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    errors.push(`[${filePath}] 'questions' alani bos olamaz.`);
    return [];
  }

  const extractedQuestions = [];
  questions.forEach((question, index) => {
    const label = `[${filePath}] questions[${index}]`;
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      errors.push(`${label} nesne olmali.`);
      return;
    }

    if (typeof question.q !== "string" || !question.q.trim()) {
      errors.push(`${label}.q zorunlu ve metin olmali.`);
    } else {
      extractedQuestions.push(question.q);
    }

    if (!Array.isArray(question.options) || question.options.length < 2) {
      errors.push(`${label}.options en az 2 secenek icermeli.`);
    } else {
      question.options.forEach((option, optionIndex) => {
        if (typeof option !== "string" || !option.trim()) {
          errors.push(`${label}.options[${optionIndex}] bos olamaz.`);
        }
      });
    }

    if (
      !Number.isInteger(question.correct) ||
      !Array.isArray(question.options) ||
      question.correct < 0 ||
      question.correct >= question.options.length
    ) {
      errors.push(`${label}.correct gecerli bir secenek index'i olmali.`);
    }

    if (
      question.explanation !== undefined &&
      typeof question.explanation !== "string"
    ) {
      errors.push(`${label}.explanation metin olmali.`);
    }

    if (question.subject !== undefined && typeof question.subject !== "string") {
      errors.push(`${label}.subject metin olmali.`);
    }
  });

  return extractedQuestions;
}

function validateCardArray(cards, filePath, errors, sourceLabel) {
  if (!Array.isArray(cards) || cards.length === 0) {
    errors.push(`[${filePath}] '${sourceLabel}' alani bos olamaz.`);
    return [];
  }

  const extractedQuestions = [];
  cards.forEach((card, index) => {
    const label = `[${filePath}] ${sourceLabel}[${index}]`;
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      errors.push(`${label} nesne olmali.`);
      return;
    }

    if (typeof card.q !== "string" || !card.q.trim()) {
      errors.push(`${label}.q zorunlu ve metin olmali.`);
    } else {
      extractedQuestions.push(card.q);
    }

    if (typeof card.a !== "string" || !card.a.trim()) {
      errors.push(`${label}.a zorunlu ve metin olmali.`);
    }

    if (card.subject !== undefined && typeof card.subject !== "string") {
      errors.push(`${label}.subject metin olmali.`);
    }
  });

  return extractedQuestions;
}

function validateJsonSet(content, filePath, errors) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    errors.push(`[${filePath}] JSON parse hatasi: ${error.message}`);
    return [];
  }

  if (Array.isArray(parsed)) {
    return validateCardArray(parsed, filePath, errors, "cards");
  }

  if (!parsed || typeof parsed !== "object") {
    errors.push(`[${filePath}] JSON kok nesnesi object veya array olmali.`);
    return [];
  }

  if (parsed.setName !== undefined && typeof parsed.setName !== "string") {
    errors.push(`[${filePath}] setName metin olmali.`);
  }

  if (Array.isArray(parsed.questions)) {
    return validateMcqJson(parsed, filePath, errors);
  }

  if (Array.isArray(parsed.cards)) {
    return validateCardArray(parsed.cards, filePath, errors, "cards");
  }

  errors.push(
    `[${filePath}] Taninmayan sema. 'questions' veya 'cards' dizisi bekleniyor.`,
  );
  return [];
}

function validateMarkdownSet(content, filePath, errors) {
  const questions = parseMarkdownQuestions(content);
  if (questions.length === 0) {
    errors.push(
      `[${filePath}] Markdown set icinde soru bulunamadi (###, Soru:, Soru N:).`,
    );
  }
  return questions;
}

function formatOccurrence(entry) {
  return `${entry.file} [${entry.source} #${entry.index + 1}]`;
}

function validateSetFiles(rawArgs = process.argv.slice(2)) {
  let cliConfig;
  try {
    cliConfig = parseCliArgs(rawArgs);
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      logs: [`❌ ${error.message}`],
    };
  }

  let files = [];
  try {
    const allowMissingPaths =
      !cliConfig.requireFiles && cliConfig.usedDefaultTarget
        ? new Set([path.resolve("data")])
        : new Set();
    files = collectSetFiles(cliConfig.inputTargets, { allowMissingPaths });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      logs: [`❌ ${error.message}`],
    };
  }

  if (files.length === 0) {
    if (cliConfig.requireFiles) {
      return {
        ok: false,
        exitCode: 1,
        logs: ["❌ Dogrulanacak .json/.md set dosyasi bulunamadi."],
      };
    }

    return {
      ok: true,
      exitCode: 0,
      logs: ["⚠️ Dogrulanacak .json/.md set dosyasi bulunamadi."],
    };
  }

  const errors = [];
  const questionIndex = new Map();
  let totalQuestionCount = 0;

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, "utf8");

    const questions =
      extension === ".json"
        ? validateJsonSet(content, filePath, errors)
        : validateMarkdownSet(content, filePath, errors);

    questions.forEach((questionText, index) => {
      const normalized = normalizeQuestionText(questionText);
      if (!normalized) {
        errors.push(
          `[${filePath}] Soru metni normalize sonrasi bos kaldi (#${index + 1}).`,
        );
        return;
      }

      const hash = questionHash(normalized);
      const occurrences = questionIndex.get(hash) || [];
      occurrences.push({
        file: filePath,
        source: extension === ".json" ? "json" : "md",
        index,
        text: questionText.trim(),
      });
      questionIndex.set(hash, occurrences);
      totalQuestionCount += 1;
    });
  }

  const duplicateGroups = [];
  for (const [hash, occurrences] of questionIndex.entries()) {
    if (occurrences.length > 1) {
      duplicateGroups.push({ hash, occurrences });
    }
  }

  const logs = [];
  if (errors.length > 0) {
    logs.push("❌ Sema dogrulama hatalari:");
    errors.forEach((error) => logs.push(`- ${error}`));
  }

  if (duplicateGroups.length > 0) {
    logs.push("❌ Duplicate soru tespit edildi:");
    duplicateGroups.forEach((group, idx) => {
      logs.push(`- Grup ${idx + 1} (${group.hash.slice(0, 12)}...):`);
      group.occurrences.forEach((occurrence) => {
        logs.push(`  • ${formatOccurrence(occurrence)} => "${occurrence.text}"`);
      });
    });
  }

  if (errors.length > 0 || duplicateGroups.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      logs,
    };
  }

  logs.push(
    `✅ Dogrulama basarili. Dosya: ${files.length}, soru: ${totalQuestionCount}, duplicate: 0`,
  );
  return {
    ok: true,
    exitCode: 0,
    logs,
  };
}

function runSetValidationCli(rawArgs = process.argv.slice(2)) {
  const result = validateSetFiles(rawArgs);
  result.logs.forEach((line) => {
    if (line.startsWith("❌")) {
      console.error(line);
    } else if (line.startsWith("-") || line.startsWith("  •")) {
      if (result.ok) {
        console.log(line);
      } else {
        console.error(line);
      }
    } else if (line.startsWith("⚠️")) {
      console.log(line);
    } else if (result.ok) {
      console.log(line);
    } else {
      console.error(line);
    }
  });

  process.exit(result.exitCode);
}

module.exports = {
  validateSetFiles,
  runSetValidationCli,
};
