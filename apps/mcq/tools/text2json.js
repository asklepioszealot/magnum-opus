#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parseStudyText } = require('../../../packages/shared-content/parse-study-text.cjs');

if (process.argv.length < 4) {
    console.log("Kullanım: node text2json.js <girdi_metni.txt> <cikti_dosyasi.json>");
    process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];
const fileStem = path.parse(inputFile).name;

const content = fs.readFileSync(inputFile, 'utf-8');
const parsed = parseStudyText(content, {
    defaultSetName: fileStem,
    supportsHeadingQuestions: false,
    blockquoteStartsExplanation: true,
});

const result = {
    setName: parsed.setName || fileStem,
    questions: []
};

function processFormatting(text) {
    return text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

parsed.entries.forEach((entry) => {
    const explanation = entry.explanationLines
        .map((line) => processFormatting(line.trim()))
        .join('<br>')
        .trim();

    result.questions.push({
        q: processFormatting(entry.prompt),
        options: entry.options.map((option) => processFormatting(option)),
        correct: entry.correctChar ? entry.correctChar.charCodeAt(0) - 65 : -1,
        explanation,
        subject: entry.subject || parsed.canonicalSubject,
    });
});

const outputDir = path.dirname(path.resolve(outputFile));
if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
console.log(`Dönüştürme tamamlandı: ${result.questions.length} soru '${outputFile}' dosyasına kaydedildi.`);
