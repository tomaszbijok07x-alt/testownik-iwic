import {STORAGE_KEY, filterQuestions, topicFor, shuffle, weightedPractice, isCorrect, resultFor, emptySaved, validateSaved, remainingSeconds, examSettings} from './core.mjs';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const percent = n => n.toLocaleString('pl-PL', {maximumFractionDigits: 2}) + '%';
const modeNames = {learn: 'Nauka', exam: 'Egzamin', all: 'Po kolei', smart: 'Inteligentne powtórki', wrong: 'Powtórka błędów', quick: 'Szybkie pytania losowe'};
let DB = [], TOPICS = [], selectedTopics = new Set(), session = null, pendingImport = null, toastTimer;
let saved = emptySaved(), loadWarning = '';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) saved = validateSaved(JSON.parse(raw));
} catch (e) {
  loadWarning = 'Nie udało się odczytać wcześniejszych postępów. Nie usunięto zapisanych danych.';
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
  catch (e) { toast('Nie udało się zapisać postępów. Sprawdź wolne miejsce lub ustawienia przeglądarki.'); }
}

function applyTheme() {
  document.body.classList.toggle('light', saved.theme === 'light');
  $('theme').textContent = saved.theme === 'light' ? '☾' : '☼';
  document.querySelector('meta[name="theme-color"]').content = saved.theme === 'light' ? '#f5f6f0' : '#101820';
}
applyTheme();
$('theme').onclick = () => {
  saved.theme = saved.theme === 'dark' ? 'light' : 'dark';
  persist(); applyTheme();
};

function route() {
  if (session && !session.finished) return;
  const tab = ['tematy', 'statystyki', 'wyniki'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'start';
  $('workspace').hidden = false;
  $('quizView').hidden = true;
  $('finishView').hidden = true;
  $('startView').hidden = tab !== 'start';
  $('topicsView').hidden = tab !== 'tematy';
  $('statsView').hidden = tab !== 'statystyki';
  $('resultsView').hidden = tab !== 'wyniki';
  if (tab === 'wyniki') renderExamResults();
  document.body.classList.remove('quiz-active');
  document.querySelectorAll('[data-tab]').forEach(a => {
    const active = a.dataset.tab === tab;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (tab === 'statystyki' || tab === 'start') renderStats();
}
window.addEventListener('hashchange', route);
document.querySelector('.brand').onclick = e => {
  if (session && !session.finished) { e.preventDefault(); $('quitDialog').showModal(); }
  else if (session?.finished) { e.preventDefault(); goHome(); }
};

function scopeText(all = false) {
  if (all) return 'Cała baza';
  const names = [...selectedTopics].map(id => id === 'unassigned' ? 'Bez przypisanego tematu' : TOPICS.find(t => t.id === id)?.title).filter(Boolean);
  const lo = Number($('from').value), hi = Number($('to').value);
  const range = lo === DB[0].id && hi === DB.at(-1).id ? '' : `numery od ${lo} do ${hi}`;
  return [names.length ? names.join(' + ') : 'Cała baza', range].filter(Boolean).join(', ');
}

function selectedPool() {
  return filterQuestions(DB, TOPICS, {topicIds: [...selectedTopics], from: $('from').value, to: $('to').value});
}

function updateSelection() {
  try {
    const pool = selectedPool();
    $('poolCount').textContent = pool.length;
    $('mobilePoolCount').textContent = `${pool.length} pytań w puli`;
    $('scopeDescription').textContent = scopeText();
    $('selectionError').textContent = pool.length ? '' : 'W tym wyborze nie ma pytań. Zmień temat lub zakres numerów.';
    $('startSelection').disabled = !pool.length;
    $('mobileStartSelection').disabled = !pool.length;
  } catch (e) {
    $('poolCount').textContent = '0';
    $('mobilePoolCount').textContent = 'Nieprawidłowy zakres';
    $('selectionError').textContent = e.message;
    $('startSelection').disabled = true;
    $('mobileStartSelection').disabled = true;
  }
  document.querySelectorAll('#topicList input').forEach(input => { input.checked = selectedTopics.has(input.value); });
  const label = $('topicsCount');
  label.textContent = label.textContent.replace(/zaznaczono: \d+/, `zaznaczono: ${selectedTopics.size}`);
}

function renderTopics() {
  const search = $('topicSearch').value.trim().toLocaleLowerCase('pl-PL');
  const allTopics = [...TOPICS, {id: 'unassigned', title: 'Bez przypisanego tematu', code: '', group: 'Pozostałe pytania', ranges: []}];
  const holder = $('topicList'); holder.replaceChildren();
  let lastGroup = '', shown = 0;
  for (const t of allTopics) {
    if (search && !`${t.title} ${t.code}`.toLocaleLowerCase('pl-PL').includes(search)) continue;
    const questions = DB.filter(q => (topicFor(q.id, TOPICS)?.id || 'unassigned') === t.id);
    if (!questions.length) continue;
    shown++;
    if (t.group !== lastGroup) { holder.append(el('div', 'topic-group-title', t.group.toLocaleUpperCase('pl-PL'))); lastGroup = t.group; }
    const row = el('label', 'topic-card');
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.value = t.id; checkbox.checked = selectedTopics.has(t.id);
    checkbox.onchange = () => { if (checkbox.checked) selectedTopics.add(t.id); else selectedTopics.delete(t.id); updateSelection(); };
    const description = el('span');
    description.append(el('strong', '', t.title));
    const range = t.ranges.length ? t.ranges.map(([lo, hi]) => `od ${lo} do ${hi}`).join(', ') : 'Bez potwierdzonego podziału źródłowego';
    description.append(el('small', '', [t.code, range].filter(Boolean).join(' · ')));
    row.append(checkbox, description, el('span', 'topic-number', questions.length));
    holder.append(row);
  }
  $('topicsCount').textContent = `Widoczne zestawy: ${shown} · zaznaczono: ${selectedTopics.size}`;
  if (!shown) holder.append(el('p', 'muted small', 'Brak tematów pasujących do wyszukiwania. Zmień wpisaną nazwę.'));
}
$('topicSearch').oninput = renderTopics;
$('clearTopics').onclick = () => { selectedTopics.clear(); renderTopics(); updateSelection(); };
['from', 'to'].forEach(id => { $(id).oninput = updateSelection; });

function begin(mode, source, limit, scope, minutes = null) {
  let candidates = source;
  if (mode === 'wrong') candidates = candidates.filter(q => saved.wrong.includes(q.id));
  if (!candidates.length) { toast(mode === 'wrong' ? 'Nie masz błędnych pytań w wybranej puli.' : 'W wybranej puli nie ma pytań.'); return; }
  const n = limit === 'all' ? candidates.length : Math.min(Number(limit), candidates.length);
  const pool = mode === 'all' ? [...candidates].sort((a, b) => a.id - b.id) : mode === 'smart' ? weightedPractice(candidates, n, saved.questionStats) : shuffle(candidates).slice(0, n);
  session = {startedAt: Date.now(), timeLimitMinutes: minutes, deadline: minutes ? Date.now() + minutes * 60000 : null, mode, pool, scope, idx: 0, hits: 0, responses: [], selected: [], locked: false, finished: false};
  $('workspace').hidden = true; $('finishView').hidden = true; $('quizView').hidden = false;
  $('reviewList').hidden = true; $('reviewList').replaceChildren();
  document.body.classList.add('quiz-active');
  renderQuestion(); startTimer(); window.scrollTo({top: 0});
}
$('startSelection').onclick = () => {
  try { begin($('sessionMode').value, selectedPool(), $('limit').value, scopeText()); }
  catch (e) { toast(e.message); }
};
$('mobileStartSelection').onclick = () => $('startSelection').click();
$('startExam').onclick = () => {
  try { const settings = examSettings($('examCount').value, $('examMinutes').value, DB.length); $('examError').textContent = ''; begin('exam', DB, settings.count, 'Cała baza', settings.minutes); }
  catch (e) { $('examError').textContent = e.message; }
};
$('startSmart').onclick = () => begin('smart', DB, 30, 'Cała baza');
$('startWrong').onclick = () => begin('wrong', DB, 30, 'Cała baza');
document.querySelectorAll('[data-quick]').forEach(button => { button.onclick = () => begin('quick', DB, Number(button.dataset.quick), 'Cała baza'); });

function renderQuestion() {
  const s = session;
  if (s.idx >= s.pool.length) { finish(false); return; }
  s.selected = []; s.locked = false;
  const q = s.pool[s.idx], t = topicFor(q.id, TOPICS);
  $('modeLabel').textContent = modeNames[s.mode];
  $('quizScope').textContent = s.scope;
  $('position').textContent = `Pytanie ${s.idx + 1} z ${s.pool.length}`;
  $('score').textContent = s.mode === 'exam' ? `Zapisano: ${s.responses.length}` : `Poprawne: ${s.hits}`;
  $('quizBar').style.width = `${s.idx / s.pool.length * 100}%`;
  $('questionNumber').textContent = `NR ${q.id} · ${t?.code || 'PULA OGÓLNA'}`;
  $('question').textContent = q.q;
  $('answers').replaceChildren();
  q.a.forEach((answer, i) => {
    const button = el('button', 'option');
    button.type = 'button'; button.setAttribute('aria-pressed', 'false'); button.dataset.option = i;
    button.append(el('span', 'letter', String.fromCharCode(65 + i)), el('span', 'answer-text', answer));
    button.onclick = () => {
      if (s.locked) return;
      s.selected = s.selected.includes(i) ? s.selected.filter(x => x !== i) : [...s.selected, i];
      [...$('answers').children].forEach((b, j) => { const selected = s.selected.includes(j); b.classList.toggle('sel', selected); b.setAttribute('aria-pressed', String(selected)); });
      $('check').disabled = !s.selected.length;
    };
    $('answers').append(button);
  });
  $('feedback').textContent = ''; $('feedback').style.color = '';
  $('check').hidden = false; $('check').disabled = true;
  $('check').textContent = s.mode === 'exam' ? 'Zapisz odpowiedź' : 'Sprawdź odpowiedź';
  $('next').hidden = true;
}

function check() {
  if (expireIfNeeded()) return;
  const s = session;
  if (!s || s.locked || !s.selected.length || s.finished) return;
  s.locked = true;
  const q = s.pool[s.idx], ok = isCorrect(q, s.selected);
  s.responses.push({id: q.id, selected: [...s.selected], ok});
  saved.total++;
  const stat = saved.questionStats[q.id] || {correct: 0, wrong: 0, streak: 0, last: 0};
  stat.last = Date.now();
  if (ok) { stat.correct++; stat.streak++; saved.correct++; s.hits++; saved.wrong = saved.wrong.filter(id => id !== q.id); }
  else { stat.wrong++; stat.streak = 0; if (!saved.wrong.includes(q.id)) saved.wrong.push(q.id); }
  saved.questionStats[q.id] = stat;
  persist();
  $('score').textContent = s.mode === 'exam' ? `Zapisano: ${s.responses.length}` : `Poprawne: ${s.hits}`;
  [...$('answers').children].forEach((button, i) => {
    button.disabled = true;
    if (s.mode === 'exam') return;
    const correct = q.k.includes(i), selected = s.selected.includes(i);
    button.classList.toggle('correct', correct); button.classList.toggle('wrong', selected && !correct);
    if (correct || selected) button.lastElementChild.append(el('small', 'answer-status', correct ? (selected ? '✓ Poprawna odpowiedź' : '✓ Poprawna odpowiedź, pominięta') : '✗ Błędna odpowiedź, zaznaczona'));
  });
  $('feedback').textContent = s.mode === 'exam' ? 'Odpowiedź zapisana. Ocena i poprawne odpowiedzi będą dostępne po zakończeniu.' : ok ? '✓ Poprawna odpowiedź' : '✗ Błędna odpowiedź. Zielone pola wskazują wszystkie poprawne odpowiedzi.';
  if (s.mode !== 'exam') $('feedback').style.color = ok ? 'var(--ok)' : 'var(--bad)';
  $('check').hidden = true; $('next').hidden = false;
  $('next').textContent = s.idx === s.pool.length - 1 ? 'Zobacz wynik' : 'Następne pytanie';
}
$('check').onclick = check;
$('next').onclick = () => { if (expireIfNeeded()) return; if (!session?.locked || session.finished) return; session.idx++; renderQuestion(); window.scrollTo({top: 0}); };

function finish(interrupted, timedOut = false) {
  const s = session;
  if (!s || s.finished) return;
  s.finished = true;
  clearInterval(examInterval); $('examTimer').hidden = true;
  if ($('quitDialog').open) $('quitDialog').close();
  const unanswered = timedOut ? s.pool.length - s.responses.length : 0;
  if (timedOut) {
    const answered = new Set(s.responses.map(r => r.id));
    for (const q of s.pool) if (!answered.has(q.id)) s.responses.push({id:q.id, selected:[], ok:false, unanswered:true});
  }
  const durationSeconds = Math.min(Math.floor((Date.now() - s.startedAt) / 1000), s.timeLimitMinutes ? s.timeLimitMinutes * 60 : Infinity);
  const total = s.responses.length;
  if (!total) { goHome(); return; }
  const r = resultFor(s.hits, total);
  $('quizView').hidden = true; $('finishView').hidden = false;
  $('finalTiming').textContent = `Czas: ${formatDuration(durationSeconds)}${s.timeLimitMinutes ? ` z ${s.timeLimitMinutes} min` : ''}${timedOut ? `. Czas upłynął. Bez odpowiedzi: ${unanswered} (wliczone do błędnych).` : ''}`;
  $('finishTitle').textContent = timedOut ? 'Czas egzaminu upłynął' : interrupted ? 'Sesja przerwana' : s.mode === 'quick' ? 'Szybka seria zakończona' : 'Sesja zakończona';
  $('resultSymbol').textContent = interrupted || s.mode === 'quick' ? '◎' : r.passed ? '✓' : '↗';
  $('finalPercent').textContent = percent(r.percent);
  $('finalInfo').textContent = `${s.hits} z ${total} poprawnych odpowiedzi. ${s.scope}.`;
  $('finalCorrect').textContent = s.hits; $('finalWrong').textContent = total - s.hits;
  const status = $('finalStatus');
  status.className = 'status' + (interrupted || s.mode === 'quick' ? '' : r.passed ? ' pass' : ' fail');
  status.textContent = interrupted ? 'Wynik częściowy. Ta sesja nie jest oceniana progiem i nie trafia do historii ukończonych testów.' : s.mode === 'quick' ? 'Wynik służy do nauki. Szybkie serie nie mają progu zaliczenia.' : `${r.passed ? '✓ Test zaliczony.' : '✗ Test niezaliczony.'} Próg: 71%. W tym zestawie wymagane: ${r.required} z ${total} poprawnych odpowiedzi.`;
  if (!interrupted) {
    saved.history.unshift({date: new Date().toISOString(), mode: s.mode, correct: s.hits, total, percent: r.percent, passed: r.passed, scope: s.scope, unanswered, durationSeconds, timeLimitMinutes:s.timeLimitMinutes, timedOut});
    saved.history = saved.history.slice(0, 100); persist();
  }
  $('reviewSession').hidden = false; window.scrollTo({top: 0});
}
$('quitQuiz').onclick = () => $('quitDialog').showModal();
$('resumeQuiz').onclick = () => $('quitDialog').close();
$('confirmQuit').onclick = () => { $('quitDialog').close(); finish(true); };
function goHome() {
  clearInterval(examInterval);
  session = null; location.hash = 'start'; route(); window.scrollTo({top: 0});
}
$('backHome').onclick = goHome;
$('reviewSession').onclick = () => {
  const holder = $('reviewList'); holder.replaceChildren(); holder.hidden = false;
  session.responses.forEach(response => {
    const q = DB.find(x => x.id === response.id);
    const panel = el('article', 'panel');
    panel.append(el('div', 'eyebrow', `PYTANIE ${q.id} · ${response.unanswered ? 'BEZ ODPOWIEDZI' : response.ok ? 'POPRAWNIE' : 'BŁĄD'}`), el('h2', '', q.q));
    q.a.forEach((answer, i) => {
      const correct = q.k.includes(i), selected = response.selected.includes(i);
      const row = el('div', 'review-answer' + (correct ? ' correct' : selected ? ' wrong' : ''), `${String.fromCharCode(65 + i)}. ${answer}`);
      if (correct || selected) row.append(el('small', '', correct ? (selected ? '✓ Poprawna, zaznaczona' : '✓ Poprawna, pominięta') : '✗ Błędna, zaznaczona'));
      panel.append(row);
    });
    holder.append(panel);
  });
  $('reviewSession').hidden = true; holder.scrollIntoView({block: 'start'});
};

function renderStats() {
  const exams = saved.history.filter(h => h.mode === 'exam');
  const availableWrong = DB.filter(q => saved.wrong.includes(q.id)).length;
  $('homeExams').textContent = exams.length; $('homeWrong').textContent = availableWrong;
  const stats = Object.values(saved.questionStats);
  const values = [[exams.length, 'ukończone egzaminy'], [exams.length ? percent(Math.max(...exams.map(h => resultFor(h.correct, h.total).percent))) : '0%', 'najlepszy egzamin'], [saved.correct, 'poprawne odpowiedzi'], [saved.total - saved.correct, 'błędne odpowiedzi'], [availableWrong, 'pytań do powtórki'], [stats.filter(s => s.streak >= 3).length, 'opanowane, 3 poprawne z rzędu']];
  $('statsCards').replaceChildren(...values.map(([value, label]) => { const card = el('div', 'stats-card'); card.append(el('strong', '', value), el('span', '', label)); return card; }));
  const overall = resultFor(saved.correct, saved.total).percent;
  $('overallPercent').textContent = percent(overall); $('overallBar').style.width = `${overall}%`;
  const last = exams[0], readiness = $('readiness');
  readiness.className = 'status' + (last ? resultFor(last.correct, last.total).passed ? ' pass' : ' fail' : '');
  readiness.textContent = last ? `Ostatni egzamin: ${percent(resultFor(last.correct, last.total).percent)}. ${resultFor(last.correct, last.total).passed ? 'Próg 71% osiągnięty.' : 'Cel: minimum 71%.'} Zakres: ${last.scope || 'Cała baza'}.` : 'Ukończ test egzaminacyjny, aby zobaczyć ocenę wyniku.';
  const holder = $('history'); holder.replaceChildren();
  if (!saved.history.length) holder.append(el('p', 'muted small', 'Pierwszy ukończony test pojawi się tutaj.'));
  for (const h of saved.history) {
    const r = resultFor(h.correct, h.total), row = el('div', 'history-row');
    const desc = el('div'); desc.append(el('strong', '', modeNames[h.mode]), el('small', '', new Date(h.date).toLocaleString('pl-PL', {dateStyle: 'short', timeStyle: 'short'})), el('small', '', h.scope || 'Cała baza'));
    const score = el('div', 'history-result'); score.append(el('strong', '', percent(r.percent)), el('small', '', `${h.correct}/${h.total} · ${h.mode === 'quick' ? 'Seria nauki' : r.passed ? 'Zaliczony' : 'Niezaliczony'}`));
    score.style.color = h.mode === 'quick' ? 'var(--text)' : r.passed ? 'var(--ok)' : 'var(--bad)';
    row.append(desc, score); holder.append(row);
  }
}

$('exportProgress').onclick = () => {
  const data = {app: 'testownik-iwic-e', format: 1, exportedAt: new Date().toISOString(), saved};
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const anchor = el('a'); anchor.href = url; anchor.download = `testownik-postepy-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  $('backupStatus').textContent = 'Kopia postępów została przygotowana do pobrania.';
};
$('importProgress').onclick = () => $('progressFile').click();
$('progressFile').onchange = async () => {
  pendingImport = null; $('importPreview').hidden = true;
  const file = $('progressFile').files[0]; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Plik jest zbyt duży. Wybierz kopię postępów Testownika.');
    const json = JSON.parse(await file.text());
    if (json.saved && json.app !== 'testownik-iwic-e') throw new Error('To nie jest kopia postępów Testownika.');
    pendingImport = validateSaved(json.saved || json);
    $('importSummary').textContent = `Kopia: ${pendingImport.total} sprawdzonych odpowiedzi, ${pendingImport.history.length} sesji. Zastąpi obecne postępy. Najpierw pobierz kopię obecnych danych, jeśli chcesz je zachować.`;
    $('importPreview').hidden = false; $('backupStatus').textContent = '';
  } catch (e) { $('backupStatus').textContent = e.message || 'Nie udało się odczytać kopii.'; }
  $('progressFile').value = '';
};
$('applyImport').onclick = () => {
  if (!pendingImport) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingImport)); }
  catch (e) { $('backupStatus').textContent = 'Nie udało się zapisać kopii. Obecne postępy zostały zachowane.'; return; }
  saved = pendingImport; pendingImport = null; $('importPreview').hidden = true;
  applyTheme(); renderStats(); $('backupStatus').textContent = 'Wczytano postępy z kopii.';
};
$('cancelImport').onclick = () => { pendingImport = null; $('importPreview').hidden = true; };

let examInterval;
function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
function expireIfNeeded() {
  if (session && !session.finished && session.deadline && Date.now() >= session.deadline) { finish(false, true); return true; }
  return false;
}
function tickTimer() {
  if (!session || session.finished || !session.deadline) return;
  if (expireIfNeeded()) return;
  const left = remainingSeconds(session.deadline);
  $('examTimer').textContent = `Pozostało: ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
  $('examTimer').classList.toggle('urgent', left <= 60);
}
function startTimer() {
  clearInterval(examInterval);
  $('examTimer').hidden = !session.deadline;
  if (session.deadline) { tickTimer(); examInterval = setInterval(tickTimer, 250); }
}
document.addEventListener('visibilitychange', tickTimer);
window.addEventListener('focus', tickTimer);
function renderExamResults() {
  const exams = saved.history.filter(h => h.mode === 'exam');
  const total = exams.reduce((n,h)=>n+h.total,0), correct = exams.reduce((n,h)=>n+h.correct,0);
  const summary = [[exams.length,'ukończone egzaminy'],[percent(resultFor(correct,total).percent),'łączna skuteczność'],[exams.filter(h=>resultFor(h.correct,h.total).passed).length,'zaliczone egzaminy']];
  $('examSummary').replaceChildren(...summary.map(([value,label])=>{const card=el('div','stats-card');card.append(el('strong','',value),el('span','',label));return card;}));
  const holder=$('examResults');holder.replaceChildren();
  if(!exams.length){holder.append(el('div','panel','Nie masz jeszcze ukończonych egzaminów. Rozpocznij egzamin w zakładce Nauka lub Tematy.'));return;}
  for(const h of exams){
    const r=resultFor(h.correct,h.total), card=el('article','panel');
    const heading=el('div','exam-result-head');heading.append(el('h2','',new Date(h.date).toLocaleString('pl-PL',{dateStyle:'short',timeStyle:'short'})),el('span','status '+(r.passed?'pass':'fail'),r.passed?'Zaliczony':'Niezaliczony'));card.append(heading,el('p','exam-meta',h.scope||'Cała baza'));
    const grid=el('div','exam-result-grid');
    for(const [value,label] of [[percent(r.percent),'wynik'],[h.correct,'poprawne'],[h.total-h.correct,'błędne'],[h.total,'wszystkie pytania']]){const x=el('div');x.append(el('strong','',value),el('span','',label));grid.append(x);}card.append(grid);
    card.append(el('p','exam-meta',h.durationSeconds == null ? 'Czas: brak danych w starszym wyniku.' : `Czas wykonania: ${formatDuration(h.durationSeconds)}${h.timeLimitMinutes ? ` • Limit: ${h.timeLimitMinutes} min` : ''}`));
    if(h.timedOut)card.append(el('p','exam-meta',`Zakończony po upływie czasu. Bez odpowiedzi: ${h.unanswered} (wliczone do błędnych).`));
    holder.append(card);
  }
}

async function verifyOffline() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    $('offlineDetails').textContent = 'Zapis offline wymaga bezpiecznego adresu i aktywnej aplikacji. Otwórz adres aplikacji online i odśwież stronę.';
    return;
  }
  const channel = new MessageChannel();
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({ok: false}), 5000);
    channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); };
    navigator.serviceWorker.controller.postMessage({type: 'VERIFY_OFFLINE'}, [channel.port2]);
  });
  $('offlineStatus').textContent = result.ok ? (navigator.onLine ? 'Gotowe offline' : 'Pracujesz offline') : 'Zapis offline nie jest kompletny';
  $('offlineDetails').textContent = result.ok ? 'Baza pytań i wszystkie pliki aplikacji są zapisane na tym urządzeniu. Możesz otworzyć aplikację bez internetu.' : 'Nie potwierdzono pełnego zapisu. Połącz się z internetem i ponownie otwórz aplikację.';
}
$('verifyOffline').onclick = verifyOffline;
async function initOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    $('offlineStatus').textContent = 'Tryb online, zapis offline wymaga HTTPS'; return;
  }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) verifyOffline();
    navigator.serviceWorker.addEventListener('controllerchange', verifyOffline);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'activated') toast('Pobrano pliki aplikacji do pracy offline.');
      });
    });
  } catch (e) { $('offlineStatus').textContent = 'Nie udało się przygotować trybu offline'; }
}
window.addEventListener('online', verifyOffline); window.addEventListener('offline', verifyOffline);

async function init() {
  try {
    const results = await Promise.all(['questions.json', 'topics.json'].map(async path => {
      const r = await fetch(path); if (!r.ok) throw new Error('Nie udało się wczytać bazy.'); return r.json();
    }));
    [DB, TOPICS] = results;
    $('dbCount').textContent = DB.length;
    $('from').min = $('to').min = DB[0].id;
    $('from').max = $('to').max = DB.at(-1).id;
    $('from').value = DB[0].id; $('to').value = DB.at(-1).id;
    const unassigned = DB.filter(q => !topicFor(q.id, TOPICS)).length;
    $('unassignedInfo').textContent = unassigned ? `${unassigned} pytań bez potwierdzonego przypisania znajduje się w osobnej puli „Bez przypisanego tematu”. Możesz je wybrać do testu lub użyć zakresu numerów.` : 'Wszystkie pytania są przypisane do tematów.';
    renderTopics(); updateSelection(); renderStats();
    $('loading').hidden = true; route(); initOffline();
    if (loadWarning) toast(loadWarning);
  } catch (e) {
    $('loading').replaceChildren(el('h1', '', 'Nie udało się otworzyć bazy'), el('p', 'muted', 'Połącz się z internetem i odśwież aplikację. Postępy pozostają zapisane w przeglądarce.'));
    const retry = el('button', 'primary', 'Spróbuj ponownie'); retry.onclick = () => location.reload(); $('loading').append(retry);
  }
}
init();
