#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
    console.log("Kullanım: node text2json.js <girdi_metni.txt> <cikti_dosyasi.json>");
    process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];
const fileStem = path.parse(inputFile).name;

const content = fs.readFileSync(inputFile, 'utf-8');
const lines = content.split(/\r?\n/);

const result = {
    setName: fileStem,
    questions: []
};

let currentQuestion = null;
let canonicalSubject = fileStem;
let capturingExplanation = false;
let explanationLines = [];
let awaitingQuestionText = false;

function processFormatting(text) {
    return text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const normalizedLine = line.replace(/^\*\*(.*?)\*\*$/, '$1').trim();

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
        continue;
    }
    
    const soruInlineMatch = normalizedLine.match(/^Soru:\s*(.+)$/i);
    const soruNumberedMatch = normalizedLine.match(/^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i);

    if (soruInlineMatch || soruNumberedMatch) {
        if (currentQuestion) {
            if (capturingExplanation) {
                currentQuestion.explanation = explanationLines.join('<br>').trim();
            }
            result.questions.push(currentQuestion);
        }

        const qText = (soruInlineMatch ? soruInlineMatch[1] : (soruNumberedMatch[1] || '')).trim();
        
        currentQuestion = {
            q: processFormatting(qText),
            options: [],
            correct: -1,
            explanation: "",
            subject: canonicalSubject
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
        currentQuestion.options.push(processFormatting(optionMatch[2].trim()));
        continue;
    }
    
    const correctMatch = normalizedLine.match(/^Do(?:ğ|g)ru\s*Cevap:\s*([A-Ea-e])\b/i);
    if (correctMatch) {
        const correctChar = correctMatch[1].toUpperCase();
        if (currentQuestion) {
            currentQuestion.correct = correctChar.charCodeAt(0) - 65;
        }
        continue;
    }
    
    const explanationStartMatch = normalizedLine.match(/^(?:Açıklama|Aciklama):\s*(.*)$/i);
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
        currentQuestion.explanation = explanationLines.join('<br>').trim();
    }
    result.questions.push(currentQuestion);
}

const outputDir = path.dirname(path.resolve(outputFile));
if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
console.log(`Dönüştürme tamamlandı: ${result.questions.length} soru '${outputFile}' dosyasına kaydedildi.`);
