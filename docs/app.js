(function () {
  'use strict';

  var DATA_URL = 'data/deck.json';
  var CURRICULUM_URL = 'data/curriculum.json';
  var NOTES_INDEX_URL = 'data/reference-index.json';
  var NOTES_BASE = 'data/reference/';
  var PROGRESS_KEY = 'ccp-progress-v1';
  var THEME_KEY = 'ccp-theme';

  var GRADE_QUALITY = { again: 0, hard: 3, good: 4, easy: 5 };
  var DECK_LABELS = { 'AWS CCP Cert': 'AWS CCP Cert (core)' };
  var ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

  var state = {
    cards: [],
    cardsById: new Map(),
    curriculum: [],
    notesIndex: [],
    progress: {},
    session: null,
    lastNotesFile: null
  };

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // ---------------------------------------------------------------------
  // Progress persistence + SM-2 scheduler
  // ---------------------------------------------------------------------

  function loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
  }

  function isNewCard(id) {
    return !state.progress[id];
  }

  function isDueCard(id) {
    var p = state.progress[id];
    if (!p) return true;
    return p.dueDate <= todayStr();
  }

  function applySm2(prev, quality) {
    var p = prev || { efactor: 2.5, interval: 0, repetitions: 0 };
    var efactor = p.efactor;
    var interval = p.interval;
    var repetitions = p.repetitions;

    if (quality < 3) {
      repetitions = 0;
      interval = 1;
    } else {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * efactor);
      repetitions += 1;
    }

    efactor = Math.max(1.3, efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

    var due = new Date();
    due.setDate(due.getDate() + interval);

    return {
      efactor: efactor,
      interval: interval,
      repetitions: repetitions,
      dueDate: due.toISOString().slice(0, 10),
      lastReviewed: new Date().toISOString()
    };
  }

  function gradeCard(id, quality) {
    state.progress[id] = applySm2(state.progress[id], quality);
    saveProgress();
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------

  function loadData() {
    return Promise.all([
      fetch(DATA_URL).then(function (r) { return r.json(); }),
      fetch(CURRICULUM_URL).then(function (r) { return r.json(); }),
      fetch(NOTES_INDEX_URL).then(function (r) { return r.json(); })
    ]).then(function (results) {
      state.cards = results[0];
      state.cards.forEach(function (c) { state.cardsById.set(c.id, c); });
      state.curriculum = results[1];
      state.notesIndex = results[2];
      state.progress = loadProgress();
    });
  }

  // ---------------------------------------------------------------------
  // Stats + curriculum helpers
  // ---------------------------------------------------------------------

  function computeGlobalStats() {
    var neu = 0, due = 0, mastered = 0;
    var today = todayStr();
    state.cards.forEach(function (c) {
      var p = state.progress[c.id];
      if (!p) { neu++; return; }
      if (p.dueDate <= today) due++;
      if (p.interval >= 21) mastered++;
    });
    return { new: neu, due: due, mastered: mastered, total: state.cards.length, ready: neu + due };
  }

  function flatTopics() {
    var out = [];
    state.curriculum.forEach(function (d) {
      d.topics.forEach(function (t) { out.push({ domain: d.domain, slug: t.slug }); });
    });
    return out;
  }

  function topicOrderIndex() {
    var index = new Map();
    flatTopics().forEach(function (t, i) { index.set(t.slug, i); });
    return index;
  }

  function domainInfo(domainNum) {
    return state.curriculum.filter(function (d) { return d.domain === domainNum; })[0];
  }

  function topicInfo(slug) {
    for (var i = 0; i < state.curriculum.length; i++) {
      var d = state.curriculum[i];
      for (var j = 0; j < d.topics.length; j++) {
        if (d.topics[j].slug === slug) return { domain: d, topic: d.topics[j] };
      }
    }
    return null;
  }

  function examTags() {
    var set = new Set();
    state.cards.forEach(function (c) {
      c.tags.forEach(function (t) { if (/^exam\d+$/i.test(t)) set.add(t); });
    });
    return Array.from(set).sort(function (a, b) {
      return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10);
    });
  }

  // ---------------------------------------------------------------------
  // View router
  // ---------------------------------------------------------------------

  function mountTemplate(id) {
    var tpl = document.getElementById(id);
    var root = document.getElementById('view-root');
    root.innerHTML = '';
    root.appendChild(tpl.content.cloneNode(true));
    return root;
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (tab === 'library') renderLibrary();
    else if (tab === 'notes') renderNotes();
  }

  function wireTabbar() {
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });
  }

  // ---------------------------------------------------------------------
  // Library view
  // ---------------------------------------------------------------------

  function renderLibrary() {
    var root = mountTemplate('tpl-library');
    var stats = computeGlobalStats();

    root.querySelector('#status-line').textContent =
      stats.total.toLocaleString() + ' cards · ' + stats.ready.toLocaleString() + ' ready today · ' + stats.mastered.toLocaleString() + ' mastered';

    root.querySelector('#continue-count').textContent = stats.ready > 0 ? stats.ready.toLocaleString() + ' ready' : 'all caught up';
    root.querySelector('#btn-continue-today').addEventListener('click', function () {
      startSession({ mode: 'due' });
    });

    renderToc(root.querySelector('#toc'));
    renderExamGrid(root.querySelector('#exam-grid'));

    root.querySelector('#btn-reset-progress').addEventListener('click', confirmResetProgress);
  }

  function renderToc(container) {
    container.innerHTML = state.curriculum.map(function (d) {
      var topicsHtml = d.topics.map(function (t) {
        return '<button class="toc-topic-row" data-topic="' + escapeAttr(t.slug) + '">' +
          '<span class="toc-topic-title">' + escapeHtml(t.title) + '</span>' +
          '<span class="toc-count">' + t.count + '</span>' +
          '</button>';
      }).join('');

      return (
        '<div class="toc-domain">' +
        '<button class="toc-domain-row" data-domain="' + d.domain + '">' +
        '<span class="toc-domain-numeral">' + ROMAN[d.domain] + '</span>' +
        '<span class="toc-domain-title">' + escapeHtml(d.title) + '</span>' +
        '<span class="toc-count">' + d.count + '</span>' +
        '</button>' +
        '<div class="toc-topics">' + topicsHtml + '</div>' +
        '</div>'
      );
    }).join('');

    container.addEventListener('click', function (e) {
      var domainBtn = e.target.closest('.toc-domain-row');
      if (domainBtn) {
        startSession({ mode: 'domain', domain: Number(domainBtn.dataset.domain) });
        return;
      }
      var topicBtn = e.target.closest('.toc-topic-row');
      if (topicBtn) {
        startSession({ mode: 'topic', topic: topicBtn.dataset.topic });
      }
    });
  }

  function renderExamGrid(container) {
    var tags = examTags();
    container.innerHTML = tags.map(function (tag) {
      var num = parseInt(tag.replace(/\D/g, ''), 10);
      return '<button class="exam-chip" data-exam="' + escapeAttr(tag) + '">' + num + '</button>';
    }).join('');

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.exam-chip');
      if (!btn) return;
      startSession({ mode: 'exam', examTag: btn.dataset.exam });
    });
  }

  function confirmResetProgress() {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal">' +
      '<h3>Reset all progress?</h3>' +
      '<p>This clears every card’s spaced-repetition schedule on this device. It cannot be undone.</p>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-secondary" data-action="cancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="confirm">Reset</button>' +
      '</div></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop || e.target.dataset.action === 'cancel') {
        backdrop.remove();
      } else if (e.target.dataset.action === 'confirm') {
        state.progress = {};
        saveProgress();
        backdrop.remove();
        renderLibrary();
      }
    });
  }

  // ---------------------------------------------------------------------
  // Study sessions
  // ---------------------------------------------------------------------

  function startSession(scope) {
    var ids;

    if (scope.mode === 'due') {
      ids = state.cards.filter(function (c) { return isNewCard(c.id) || isDueCard(c.id); })
        .map(function (c) { return c.id; });
      shuffle(ids);
    } else if (scope.mode === 'domain') {
      var tIndex = topicOrderIndex();
      ids = state.cards
        .map(function (c, i) { return { c: c, i: i }; })
        .filter(function (x) { return x.c.domain === scope.domain; })
        .sort(function (a, b) {
          return (tIndex.get(a.c.topic) - tIndex.get(b.c.topic)) || (a.i - b.i);
        })
        .map(function (x) { return x.c.id; });
    } else if (scope.mode === 'topic') {
      ids = state.cards.filter(function (c) { return c.topic === scope.topic; })
        .map(function (c) { return c.id; });
    } else if (scope.mode === 'exam') {
      ids = state.cards.filter(function (c) { return c.tags.indexOf(scope.examTag) !== -1; })
        .map(function (c) { return c.id; });
    }

    state.session = { queue: ids, index: 0, scope: scope };
    document.body.classList.add('is-studying');
    renderStudy();
  }

  function sessionLabel(scope) {
    if (scope.mode === 'due') return 'Due & new';
    if (scope.mode === 'exam') return 'Exam ' + parseInt(scope.examTag.replace(/\D/g, ''), 10);
    if (scope.mode === 'domain') {
      var d = domainInfo(scope.domain);
      return ROMAN[scope.domain] + ' · ' + d.title;
    }
    if (scope.mode === 'topic') {
      var info = topicInfo(scope.topic);
      return ROMAN[info.domain.domain] + ' · ' + info.domain.title + ' — ' + info.topic.title;
    }
    return '';
  }

  function nextSectionScope(scope) {
    if (scope.mode === 'topic') {
      var topics = flatTopics();
      var i = topics.findIndex(function (t) { return t.slug === scope.topic; });
      if (i !== -1 && i + 1 < topics.length) {
        return { mode: 'topic', topic: topics[i + 1].slug };
      }
      return null;
    }
    if (scope.mode === 'domain') {
      var nextDomain = scope.domain + 1;
      if (domainInfo(nextDomain)) return { mode: 'domain', domain: nextDomain };
      return null;
    }
    return null;
  }

  function exitStudy() {
    document.body.classList.remove('is-studying');
    state.session = null;
    switchTab('library');
  }

  function renderStudy() {
    mountTemplate('tpl-study');
    document.getElementById('btn-study-exit').addEventListener('click', exitStudy);
    updateStudyCard();
  }

  function updateStudyCard() {
    var session = state.session;
    var runner = document.getElementById('study-runner');
    var cardArea = document.getElementById('card-area');

    if (session.index >= session.queue.length) {
      renderSessionComplete(cardArea, session);
      runner.textContent = sessionLabel(session.scope);
      return;
    }

    runner.textContent = sessionLabel(session.scope) + ' — ' + (session.index + 1) + ' / ' + session.queue.length;
    var card = state.cardsById.get(session.queue[session.index]);
    cardArea.innerHTML = '';
    cardArea.appendChild(card.type === 'cloze' ? buildClozeCardEl(card) : buildMcqCardEl(card));
  }

  function renderSessionComplete(cardArea, session) {
    var message = 'All caught up.';
    if (session.queue.length === 0) message = 'Nothing to study here yet.';
    else if (session.scope.mode === 'topic' || session.scope.mode === 'domain') message = 'Section complete.';
    else if (session.scope.mode === 'exam') message = 'Exam complete.';

    var next = session.queue.length > 0 ? nextSectionScope(session.scope) : null;

    var html = '<div class="empty-state"><p>' + escapeHtml(message) + '</p><div class="next-section-row">';
    if (next) {
      html += '<button class="btn" id="btn-next-section">Next: ' + escapeHtml(sessionLabel(next)) + ' &rarr;</button>';
    }
    html += '<button class="btn btn-secondary" id="btn-back-library">Back to Library</button></div></div>';

    cardArea.innerHTML = html;
    if (next) {
      document.getElementById('btn-next-section').addEventListener('click', function () { startSession(next); });
    }
    document.getElementById('btn-back-library').addEventListener('click', exitStudy);
  }

  function advanceSession() {
    state.session.index++;
    updateStudyCard();
  }

  function metaLine(card) {
    var parts = [DECK_LABELS[card.deck] || card.deck].concat(card.tags);
    return escapeHtml(parts.join(' · '));
  }

  function gradeRowHtml() {
    return (
      '<div class="grade-row" hidden>' +
      '<button class="grade-btn grade-again" data-grade="again">Again</button>' +
      '<button class="grade-btn grade-hard" data-grade="hard">Hard</button>' +
      '<button class="grade-btn grade-good" data-grade="good">Good</button>' +
      '<button class="grade-btn grade-easy" data-grade="easy">Easy</button>' +
      '</div>'
    );
  }

  function wireGradeRow(wrap, cardId) {
    wrap.querySelectorAll('.grade-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        gradeCard(cardId, GRADE_QUALITY[btn.dataset.grade]);
        advanceSession();
      });
    });
  }

  function clozeHtml(text, revealed) {
    return text.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, function (m, inner) {
      var answer = inner.split('::')[0];
      return revealed
        ? '<span class="reveal">' + answer + '</span>'
        : '<span class="blank">[...]</span>';
    });
  }

  function buildClozeCardEl(card) {
    var wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML =
      '<div class="card-meta">' + metaLine(card) + '</div>' +
      '<div class="card-body">' + clozeHtml(card.text, false) + '</div>' +
      '<div class="card-extra" hidden></div>' +
      '<div class="card-actions">' +
      '<button class="btn" data-action="reveal">Show answer</button>' +
      gradeRowHtml() +
      '</div>';

    var body = wrap.querySelector('.card-body');
    var extra = wrap.querySelector('.card-extra');
    var revealBtn = wrap.querySelector('[data-action="reveal"]');
    var gradeRow = wrap.querySelector('.grade-row');

    revealBtn.addEventListener('click', function () {
      body.classList.add('flip-out');
      setTimeout(function () {
        body.innerHTML = clozeHtml(card.text, true);
        body.classList.remove('flip-out');
        body.classList.add('flip-in');
        setTimeout(function () { body.classList.remove('flip-in'); }, 280);
      }, 180);

      if (card.extra && card.extra.trim()) {
        extra.hidden = false;
        extra.innerHTML = card.extra;
      }
      revealBtn.hidden = true;
      gradeRow.hidden = false;
    });

    wireGradeRow(wrap, card.id);
    return wrap;
  }

  function buildMcqCardEl(card) {
    var wrap = document.createElement('div');
    wrap.className = 'card';
    var multi = card.correct.length > 1;

    wrap.innerHTML =
      '<div class="card-meta">' + metaLine(card) + '</div>' +
      '<div class="card-body">' + card.question + '</div>' +
      '<div class="choices">' + card.choices.map(function (ch) {
        return '<button class="choice-btn" data-letter="' + escapeAttr(ch.letter) + '">' +
          '<span class="choice-letter">' + escapeHtml(ch.letter) + '</span><span>' + ch.text + '</span>' +
          '</button>';
      }).join('') + '</div>' +
      (multi ? '<button class="btn btn-secondary" data-action="submit-mcq" disabled>Check answer</button>' : '') +
      '<div class="explanation" hidden></div>' +
      '<div class="card-actions">' + gradeRowHtml() + '</div>';

    var choiceButtons = Array.prototype.slice.call(wrap.querySelectorAll('.choice-btn'));
    var explanation = wrap.querySelector('.explanation');
    var gradeRow = wrap.querySelector('.grade-row');
    var submitBtn = wrap.querySelector('[data-action="submit-mcq"]');
    var revealed = false;
    var selected = new Set();

    function reveal() {
      revealed = true;
      if (submitBtn) submitBtn.hidden = true;
      choiceButtons.forEach(function (btn) {
        btn.disabled = true;
        var letter = btn.dataset.letter;
        var isCorrect = card.correct.indexOf(letter) !== -1;
        var isSelected = selected.has(letter);
        btn.classList.remove('is-selected');
        if (isCorrect && isSelected) btn.classList.add('is-correct');
        else if (isCorrect && !isSelected) btn.classList.add('is-missed');
        else if (!isCorrect && isSelected) btn.classList.add('is-incorrect');
      });
      if (card.explanation) {
        explanation.hidden = false;
        explanation.innerHTML = card.explanation;
      }
      gradeRow.hidden = false;
    }

    choiceButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (revealed) return;
        var letter = btn.dataset.letter;
        if (multi) {
          if (selected.has(letter)) {
            selected.delete(letter);
            btn.classList.remove('is-selected');
          } else {
            selected.add(letter);
            btn.classList.add('is-selected');
          }
          submitBtn.disabled = selected.size === 0;
        } else {
          selected.add(letter);
          reveal();
        }
      });
    });

    if (submitBtn) submitBtn.addEventListener('click', reveal);

    wireGradeRow(wrap, card.id);
    return wrap;
  }

  // ---------------------------------------------------------------------
  // Notes view + markdown renderer
  // ---------------------------------------------------------------------

  function renderNotes() {
    var root = mountTemplate('tpl-notes');
    var list = root.querySelector('#notes-list');
    var content = root.querySelector('#notes-content');

    list.innerHTML = state.notesIndex.map(function (item) {
      return '<button class="notes-item" data-file="' + escapeAttr(item.file) + '">' +
        escapeHtml(item.title) + '</button>';
    }).join('');

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.notes-item');
      if (!btn) return;
      loadNotesFile(btn.dataset.file, list, content);
    });

    content.addEventListener('click', function (e) {
      var link = e.target.closest('a[data-internal-ref]');
      if (!link) return;
      e.preventDefault();
      loadNotesFile(link.dataset.internalRef, list, content);
    });

    var startFile = state.lastNotesFile || (state.notesIndex[0] && state.notesIndex[0].file);
    if (startFile) loadNotesFile(startFile, list, content);
  }

  function loadNotesFile(file, list, content) {
    state.lastNotesFile = file;
    list.querySelectorAll('.notes-item').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.file === file);
    });
    content.innerHTML = '<p class="empty-state">Loading&hellip;</p>';
    fetch(NOTES_BASE + file)
      .then(function (res) {
        if (!res.ok) throw new Error('not found');
        return res.text();
      })
      .then(function (md) {
        content.innerHTML = renderMarkdown(md);
        content.scrollTop = 0;
      })
      .catch(function () {
        content.innerHTML = '<p class="empty-state">Could not load this note. Visit once online so it can be cached for offline use.</p>';
      });
  }

  // --- minimal markdown -> HTML renderer, tuned to this repo's notes ---

  function unescapeMd(text) {
    return text.replace(/\\([\\`*_{}\[\]()#+\-.!&>])/g, '$1');
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s/g, '-');
  }

  function imgPlaceholder(alt) {
    var label = alt && alt.trim() ? escapeHtml(alt.trim()) : 'diagram';
    return '<span class="img-placeholder">' + label + ' (image omitted for offline use)</span>';
  }

  function renderLink(label, href) {
    if (/^https?:\/\//i.test(href)) {
      return '<a href="' + escapeAttr(href) + '" target="_blank" rel="noopener">' + label + '</a>';
    }
    if (/^#/.test(href)) {
      return '<a href="' + escapeAttr(href) + '">' + label + '</a>';
    }
    var fileMatch = /([\w-]+)\.md/.exec(href);
    if (fileMatch) {
      return '<a href="#" data-internal-ref="' + escapeAttr(fileMatch[1] + '.md') + '">' + label + '</a>';
    }
    return label;
  }

  function inlineMd(text) {
    text = unescapeMd(text);
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, function (m, alt) { return imgPlaceholder(alt); });
    text = text.replace(/<img\b[^>]*?(?:alt="([^"]*)")?[^>]*>/gi, function (m, alt) { return imgPlaceholder(alt || ''); });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, label, href) { return renderLink(label, href); });
    text = text.replace(/`([^`]+)`/g, function (m, code) { return '<code>' + escapeHtml(code) + '</code>'; });
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return text;
  }

  function uniqueSlug(base, counts) {
    var n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return n === 0 ? base : base + '-' + n;
  }

  function splitTableRow(line) {
    var trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map(function (c) { return c.trim(); });
  }

  function isListLine(line) {
    return /^(\s*)([-*]|\d+\.)\s+/.test(line);
  }

  function isBlockStart(line) {
    return /^#{1,6}\s/.test(line) ||
      /^```/.test(line) ||
      /^>\s?/.test(line) ||
      isListLine(line) ||
      line.indexOf('|') !== -1;
  }

  function parseList(lines, start) {
    function indentOf(line) {
      return /^(\s*)/.exec(line)[1].length;
    }

    function parseAt(i, indent) {
      var items = [];
      var ordered = null;
      while (i < lines.length) {
        var line = lines[i];
        if (/^\s*$/.test(line)) { i++; continue; }
        if (!isListLine(line)) break;
        var ind = indentOf(line);
        if (ind < indent) break;
        if (ind > indent) break;

        var m = /^(\s*)([-*]|(\d+)\.)\s+(.*)$/.exec(line);
        if (ordered === null) ordered = !!m[3];
        var text = m[4];
        i++;

        var childHtml = '';
        if (i < lines.length && isListLine(lines[i]) && indentOf(lines[i]) > indent) {
          var res = parseAt(i, indentOf(lines[i]));
          childHtml = res.html;
          i = res.next;
        }
        items.push('<li>' + inlineMd(text) + childHtml + '</li>');
      }
      var tag = ordered ? 'ol' : 'ul';
      return { html: '<' + tag + '>' + items.join('') + '</' + tag + '>', next: i };
    }

    return parseAt(start, indentOf(lines[start]));
  }

  function renderMarkdown(md) {
    var lines = md.replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var idCounts = new Map();
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      if (/^```/.test(line)) {
        i++;
        var codeLines = [];
        while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
        continue;
      }

      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        var level = h[1].length;
        var text = unescapeMd(h[2].trim());
        var id = uniqueSlug(slugify(text), idCounts);
        out.push('<h' + level + ' id="' + id + '">' + inlineMd(text) + '</h' + level + '>');
        i++;
        continue;
      }

      if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
        /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        var headerCells = splitTableRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        out.push(
          '<table><thead><tr>' +
          headerCells.map(function (c) { return '<th>' + inlineMd(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inlineMd(c) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table>'
        );
        continue;
      }

      if (/^>\s?/.test(line)) {
        var quoteBuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteBuf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + quoteBuf.map(inlineMd).join('<br>') + '</blockquote>');
        continue;
      }

      if (isListLine(line)) {
        var listRes = parseList(lines, i);
        out.push(listRes.html);
        i = listRes.next;
        continue;
      }

      var buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push('<p>' + inlineMd(buf.join(' ')) + '</p>');
    }

    return out.join('\n');
  }

  // ---------------------------------------------------------------------
  // Theme toggle + connectivity badge
  // ---------------------------------------------------------------------

  function wireThemeToggle() {
    var btn = document.getElementById('btn-theme-toggle');
    btn.addEventListener('click', function () {
      var dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    });
  }

  function wireConnBadge() {
    var badge = document.getElementById('conn-badge');
    function update() { badge.hidden = navigator.onLine; }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    wireTabbar();
    wireThemeToggle();
    wireConnBadge();
    registerServiceWorker();

    loadData()
      .then(function () { switchTab('library'); })
      .catch(function () {
        document.getElementById('view-root').innerHTML =
          '<p class="empty-state">Could not load study data. Visit once online so it can be cached for offline use.</p>';
      });
  });
})();
