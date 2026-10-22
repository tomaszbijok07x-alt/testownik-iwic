export const STORAGE_KEY = 'iwi-mobile-v1';
export const PASS_THRESHOLD = 71;

export function topicFor(id, topics) {
  return topics.find(t => t.ranges.some(([lo, hi]) => id >= lo && id <= hi)) || null;
}

export function filterQuestions(db, topics, {topicIds = [], from, to} = {}) {
  const min = Math.min(...db.map(q => q.id));
  const max = Math.max(...db.map(q => q.id));
  const lo = from === undefined || from === '' ? min : Number(from);
  const hi = to === undefined || to === '' ? max : Number(to);
  if (![lo, hi].every(Number.isInteger) || lo < min || hi > max || lo > hi) {
    throw new Error(`Podaj poprawny zakres numerów od ${min} do ${max}. Początek nie może być większy od końca.`);
  }
  return db.filter(q => {
    if (q.id < lo || q.id > hi) return false;
    return !topicIds.length || topicIds.includes(topicFor(q.id, topics)?.id || 'unassigned');
  });
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function weightedPractice(items, n, stats = {}, now = Date.now(), random = Math.random) {
  return items.map(q => {
    const x = stats[q.id];
    let weight = 4;
    if (x) {
      const attempts = x.correct + x.wrong;
      const errorRate = attempts ? x.wrong / attempts : 0;
      const days = Math.max(0, (now - x.last) / 86400000);
      weight = 1 + 7 * errorRate + Math.min(5, x.wrong) * 1.2 + Math.min(3, days / 7);
      if (x.streak >= 3) weight *= .3;
    }
    return {q, rank: -Math.log(Math.max(1e-12, random())) / Math.max(.15, weight)};
  }).sort((a, b) => a.rank - b.rank).slice(0, n).map(x => x.q);
}

export function isCorrect(question, selected) {
  const unique = [...new Set(selected)];
  return unique.length === question.k.length && unique.every(i => question.k.includes(i));
}

export function resultFor(correct, total) {
  return {
    percent: total ? correct / total * 100 : 0,
    passed: total > 0 && correct * 100 >= total * PASS_THRESHOLD,
    required: Math.ceil(total * PASS_THRESHOLD / 100)
  };
}

export function emptySaved() {
  return {wrong: [], total: 0, correct: 0, theme: 'dark', appearanceVersion: 3, history: [], questionStats: {}};
}

export function validateSaved(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nieprawidłowy plik postępów.');
  const natural = x => Number.isSafeInteger(x) && x >= 0;
  if (!natural(value.total) || !natural(value.correct) || value.correct > value.total ||
      !Array.isArray(value.wrong) || value.wrong.some(x => !natural(x) || !x) ||
      (value.history !== undefined && !Array.isArray(value.history)) ||
      (value.questionStats !== undefined && (!value.questionStats || typeof value.questionStats !== 'object' || Array.isArray(value.questionStats)))) {
    throw new Error('Kopia zawiera nieprawidłowe statystyki.');
  }
  const clean = emptySaved();
  clean.total = value.total;
  clean.correct = value.correct;
  clean.wrong = [...new Set(value.wrong)];
  clean.theme = value.appearanceVersion === 3 ? (value.theme === 'light' ? 'light' : 'dark') : 'dark';
  clean.history = (value.history || []).map(h => {
    if (!h || !natural(h.correct) || !natural(h.total) || !h.total || h.correct > h.total ||
        !Number.isFinite(Date.parse(h.date)) || !['learn', 'exam', 'smart', 'wrong', 'all', 'quick'].includes(h.mode)) {
      throw new Error('Kopia zawiera nieprawidłową historię testów.');
    }
    const r = resultFor(h.correct, h.total);
    return {date: h.date, mode: h.mode, correct: h.correct, total: h.total,
      percent: r.percent, passed: r.passed, unanswered: natural(h.unanswered) && h.unanswered <= h.total - h.correct ? h.unanswered : 0,
      durationSeconds: natural(h.durationSeconds) ? h.durationSeconds : null,
      timeLimitMinutes: [30,60,90,120].includes(h.timeLimitMinutes) ? h.timeLimitMinutes : null,
      timedOut: h.timedOut === true, scope: typeof h.scope === 'string' ? h.scope.slice(0, 2000) : 'Cała baza'};
  }).slice(0, 100);
  for (const [id, s] of Object.entries(value.questionStats || {})) {
    if (!/^\d+$/.test(id) || !s || ![s.correct, s.wrong, s.streak, s.last].every(natural)) {
      throw new Error('Kopia zawiera nieprawidłowe wyniki pytań.');
    }
    clean.questionStats[id] = {correct: s.correct, wrong: s.wrong, streak: s.streak, last: s.last};
  }
  return clean;
}

export function remainingSeconds(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function examSettings(count, minutes, available) {
  const n = Number(count), m = Number(minutes);
  if (![30,60,90,120].includes(n) || n > available || ![30,60,90,120].includes(m)) throw new Error('Wybierz 30, 60, 90 lub 120 pytań i dostępny czas egzaminu.');
  return {count:n, minutes:m};
}
