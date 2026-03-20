const fs = require('fs');
const path = require('path');
const { parseStudyText } = require('../../../packages/shared-content/parse-study-text.cjs');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Kullanım: node tools/md2json.js <girdi.md> [cikti.json]");
  process.exit(1);
}

const outputPath = process.argv[3] || inputPath.replace(/\.md$/, '.json');

try {
  const content = fs.readFileSync(inputPath, 'utf8');
  const fileStem = path.parse(inputPath).name;
  const parsed = parseStudyText(content, {
    defaultSetName: fileStem,
    supportsHeadingQuestions: true,
    blockquoteStartsExplanation: false,
  });
  const cards = [];

  function processFormatting(text) {
    return text
      .replace(/==([^=]+)==/g, "<strong class='highlight-critical'>$1</strong>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^(?:> )?⚠️(.*)$/gm, "<span class='highlight-important'>⚠️$1</span>");
  }

  parsed.entries.forEach((entry) => {
    const freeAnswer = entry.freeAnswerLines.join('\n').trim();
    const explanation = entry.explanationLines.join('\n').trim();

    let answerRaw = "";
    if (entry.correctChar || entry.options.length > 0 || explanation) {
      const parts = [];

      if (entry.correctChar) {
        const idx = entry.correctChar.charCodeAt(0) - 65;
        const correctOption = idx >= 0 && idx < entry.options.length
          ? entry.options[idx]
          : "";
        const correctLine = correctOption
          ? `Doğru Cevap: ${entry.correctChar}) ${correctOption}`
          : `Doğru Cevap: ${entry.correctChar}`;
        parts.push(`**${correctLine}**`);
      }

      if (explanation) {
        parts.push(explanation);
      }

      answerRaw = parts.join("\n\n").trim();
      if (!answerRaw && freeAnswer) {
        answerRaw = freeAnswer;
      }
    } else {
      answerRaw = freeAnswer;
    }

    if (!answerRaw) {
      answerRaw = "Açıklama bulunamadı.";
    }

    let answerHtml = processFormatting(answerRaw);
    answerHtml = answerHtml.replace(/\n\s*\n/g, "<br><br>\n");

    cards.push({
      q: entry.prompt,
      a: answerHtml,
      subject: entry.subject || parsed.canonicalSubject,
    });
  });
  
  const result = {
    setName: parsed.setName || fileStem,
    cards
  };

  const outputDir = path.dirname(path.resolve(outputPath));
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`✅ Dönüştürme başarılı: ${outputPath} (${cards.length} kart)`);
  
} catch (e) {
  console.error("Hata oluştu:", e);
  process.exit(1);
}
