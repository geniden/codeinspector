const BaseLayer = require('../core/base-layer');

/**
 * CodeScoreLayer — оценивает качество кода по шкале 0–10.
 * Учитывает: закомментированный код, размер файлов (монолиты), SQL-безопасность (PDO prepare),
 * типизацию (PHP), ES6+ (JS). НЕ учитывает "unused" — много ложных срабатываний (Adminer, плагины).
 */
class CodeScoreLayer extends BaseLayer {
  constructor() {
    super('code-score');
  }

  async process(snapshot, context) {
    const cq = snapshot.codeQuality || {};
    const cs = snapshot.codeStructure || {};
    const fs = snapshot.fileSystem || {};
    const fileContents = snapshot._fileContents || {};
    const issues = cq.issues || [];
    const files = fs.files || [];

    let deduction = 0;

    // ─── Штрафы только за реальное качество (не unused!) ───
    const commentedIssues = issues.filter(i => i.type === 'commented_code');
    deduction += Math.min(commentedIssues.length * 0.15, 2); // макс −2 за закомментированный код

    // ─── Штраф за большие файлы (монолиты >100KB) — только код (php, js, ts и т.д.) ───
    const CODE_EXT = /\.(php|js|jsx|ts|tsx|mjs|vue|svelte)$/i;
    const codeFiles = files.filter(f => CODE_EXT.test(f.path || ''));
    const BIG_FILE = 100 * 1024;   // 100 KB
    const HUGE_FILE = 500 * 1024;  // 500 KB
    for (const f of codeFiles) {
      const size = f.size || 0;
      if (size > HUGE_FILE) deduction += 1.5; // 500KB+ — сильный минус
      else if (size > BIG_FILE) deduction += 0.5; // 100–500KB
    }
    deduction = Math.min(deduction, 4); // макс −4 за размер

    // ─── Штраф за небезопасный SQL (PHP: mysql_query, конкатенация без prepare) ───
    const sqlPenalty = this.checkSqlSafety(fileContents);
    deduction += sqlPenalty;

    deduction = Math.min(deduction, 10);
    let score = Math.max(0, 10 - deduction);

    // ─── Бонусы за хорошие практики ───
    const bonus = this.calcBonus(fileContents, cs);
    score = Math.min(10, score + bonus);

    score = Math.round(score * 10) / 10;

    const message = this.getScoreMessage(score);

    // Собираем причины снятия баллов для отображения
    const deductions = [];
    if (commentedIssues.length > 0) deductions.push({ key: 'commented_code', count: commentedIssues.length });
    const hugeCount = codeFiles.filter(f => (f.size || 0) > HUGE_FILE).length;
    const bigCount = codeFiles.filter(f => (f.size || 0) > BIG_FILE && (f.size || 0) <= HUGE_FILE).length;
    if (hugeCount > 0) deductions.push({ key: 'large_huge', count: hugeCount });
    if (bigCount > 0) deductions.push({ key: 'large_big', count: bigCount });
    if (sqlPenalty > 0) deductions.push({ key: 'unsafe_sql' });

    return {
      codeScore: {
        score,
        message,
        deductions,
        factors: {
          commentedCode: commentedIssues.length,
          largeFiles: codeFiles.filter(f => (f.size || 0) > BIG_FILE).length,
          bonusApplied: bonus
        }
      }
    };
  }

  checkSqlSafety(fileContents) {
    let penalty = 0;
    for (const [path, content] of Object.entries(fileContents)) {
      if (!content || !/\.php$/i.test(path)) continue;
      const s = String(content).slice(0, 150000);
      const hasPrepare = /\b(->prepare\(|bindParam|bindValue|prepare\s*\(|\?\s*,\s*\?)/i.test(s);
      // mysql_query — устаревший, часто без prepared statements
      if (/\bmysql_query\s*\(/i.test(s) && !hasPrepare) penalty += 0.8;
    }
    return Math.min(penalty, 2);
  }

  calcBonus(fileContents, codeStructure) {
    let bonus = 0;
    const files = (codeStructure.files || []).slice(0, 30);
    let phpWithTypes = 0;
    let jsWithModern = 0;

    for (const file of files) {
      const path = file.path || '';
      const content = fileContents[path];
      if (!content || typeof content !== 'string') continue;

      const sample = content.slice(0, 8000);

      if (/\.php$/i.test(path)) {
        // PHP: типизация аргументов (string $x), (int $y), (array $z)
        if (/\(\s*(?:string|int|float|bool|array|object|callable|iterable|mixed)\s+\$/m.test(sample)) {
          phpWithTypes++;
        }
      } else if (/\.(js|jsx|ts|tsx|mjs)$/i.test(path)) {
        // JS: const/let, arrow functions, template literals
        const hasConst = /\bconst\s+\w+\s*=/.test(sample);
        const hasLet = /\blet\s+\w+\s*=/.test(sample);
        const hasArrow = /=>\s*\{/.test(sample);
        const hasTemplate = /`[^`]*\$\{/.test(sample);
        if (hasConst || hasLet || hasArrow || hasTemplate) jsWithModern++;
      }
    }

    if (phpWithTypes > 0) bonus += Math.min(0.4, phpWithTypes * 0.08);
    if (jsWithModern > 0) bonus += Math.min(0.3, jsWithModern * 0.05);

    return bonus;
  }

  getScoreMessage(score) {
    if (score >= 9.5) return 'Круто, так держать!';
    if (score >= 8.5) return 'Отличный код';
    if (score >= 7.0) return 'Хорошая работа';
    if (score >= 5.5) return 'Неплохо, есть куда расти';
    if (score >= 4.0) return 'Требуется внимание';
    if (score >= 2.5) return 'Много проблем — пора навести порядок';
    return 'Заставь это работать';
  }
}

module.exports = CodeScoreLayer;
