// Console-pasteable mirror of content_script.js with self-cleanup + inlined CSS.

(() => {
  'use strict';

  const VERSION = '2026.11.11';

  // Self-cleanup: tear down a previous injection if present
  if (window.__discordMdTable) {
    try {
      window.__discordMdTable.observer?.disconnect();
      if (window.__discordMdTable.intervalId) {
        clearInterval(window.__discordMdTable.intervalId);
      }
      document.getElementById('discord-md-table-style')?.remove();
      document.querySelectorAll('.md-table-rendered').forEach((n) => n.remove());
      document.querySelectorAll('.md-inline-rendered').forEach((n) => n.remove());
      document.querySelectorAll('.md-table-original-hidden, .md-inline-original-hidden').forEach((w) => {
        const parent = w.parentNode;
        while (w.firstChild) parent.insertBefore(w.firstChild, w);
        parent.removeChild(w);
      });
      document.querySelectorAll('[data-md-tables]').forEach((el) =>
        el.removeAttribute('data-md-tables')
      );
      document.querySelectorAll('[data-md-inline]').forEach((el) =>
        el.removeAttribute('data-md-inline')
      );
      document.querySelectorAll('[data-md-normalized]').forEach((el) =>
        el.removeAttribute('data-md-normalized')
      );
    } catch (e) {
      console.warn('[discord-markdown-renderer] cleanup error:', e);
    }
  }

  // CSS (the extension version loads style.css via manifest)
  const style = document.createElement('style');
  style.id = 'discord-md-table-style';
  style.textContent = `
.md-table-original-hidden, .md-inline-original-hidden { display: none !important; }
.md-inline-rendered {
}
hr.md-inline-rendered {
  border: none;
  border-top: 1px solid var(--background-modifier-accent, #3f4147);
  margin: 8px 0;
}
strong.md-inline-rendered { font-weight: 700; }
em.md-inline-rendered { font-style: italic; }
s.md-inline-rendered { text-decoration: line-through; }
u.md-inline-rendered { text-decoration: underline; }
.md-inline-rendered.md-heading {
  display: block;
  font-weight: 700;
  color: var(--header-primary, #fff);
  margin: 8px 0 4px;
  line-height: 1.25;
}
.md-inline-rendered.md-heading-1 { font-size: 1.5em; }
.md-inline-rendered.md-heading-2 { font-size: 1.25em; }
.md-inline-rendered.md-heading-3 { font-size: 1.1em; }
.md-table-rendered {
  margin-top: 8px; margin-bottom: 4px;
  overflow-x: auto; max-width: 100%;
}
.md-table-rendered table {
  border-collapse: collapse;
  font-size: 13px;
  font-family: var(--font-primary, 'gg sans', 'Noto Sans', sans-serif);
  background: var(--background-secondary, #2b2d31);
  border: 1px solid var(--background-modifier-accent, #3f4147);
  border-radius: 6px;
  overflow: hidden;
}
.md-table-rendered th, .md-table-rendered td {
  padding: 6px 12px;
  border: 1px solid var(--background-modifier-accent, #3f4147);
  text-align: left;
  color: var(--text-normal, #dbdee1);
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}
.md-table-rendered th {
  background: var(--background-tertiary, #1e1f22);
  font-weight: 600;
  color: var(--header-primary, #fff);
}
.md-table-rendered tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
.md-table-rendered tbody tr:hover { background: var(--background-modifier-hover, rgba(78,80,88,0.3)); }
.md-table-rendered[data-md-table-continuation] { margin-top: -4px; }
.md-table-rendered[data-md-table-continuation] table {
  border-top: none;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.md-table-rendered[data-md-table-followed-by-continuation] { margin-bottom: 0; }
.md-table-rendered[data-md-table-followed-by-continuation] table {
  border-bottom: none;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
[id^="chat-messages-"]:has(.md-table-rendered[data-md-table-continuation]) {
  margin-top: -16px !important;
  padding-top: 0 !important;
}
@media (prefers-color-scheme: light) {
  .md-table-rendered table { background: #fff; border-color: #e3e5e8; }
  .md-table-rendered th, .md-table-rendered td { color: #2e3338; border-color: #e3e5e8; }
  .md-table-rendered th { background: #f2f3f5; color: #060607; }
}
`.trim();
  document.head.appendChild(style);

  const MARK_ATTR = 'data-md-tables';
  const COLS_ATTR = 'data-md-table-cols';
  const CONT_ATTR = 'data-md-table-continuation';
  const BRIDGE_ATTR = 'data-md-table-bridge';
  const BRIDGE_HIDDEN_ATTR = 'data-md-table-bridge-hidden';
  const MERGED_VALUE = 'merged';
  const MERGED_INTO_ATTR = 'data-md-table-merged-into';
  const MERGED_WITH_ATTR = 'data-md-table-merged-with';
  const MERGED_ROW_COUNT_ATTR = 'data-md-table-merged-row-count';
  const MERGED_ROW_ATTR = 'data-md-table-merged-row';
  // Tail-fill: a row split across a non-adjacent boundary (3+ msg split) whose trailing
  // cells arrive as a leading orphan fragment in a later message. Reversible per-message.
  const TAIL_FILLED_BY_ATTR = 'data-md-tail-filled-by';
  const TAIL_FILL_COUNT_ATTR = 'data-md-tail-fill-count';
  const SPLIT_TABLE_ATTR = 'data-md-table-split-source';
  const INLINE_MARK_ATTR = 'data-md-inline';
  const NORMALIZED_ATTR = 'data-md-normalized';
  const HIDDEN_TABLE_CLASS = 'md-table-original-hidden';
  const HIDDEN_INLINE_CLASS = 'md-inline-original-hidden';

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/(["\\\]])/g, '\\$1');
  }
  const ROW_RE = /^\s*\|.*\|\s*$/;
  const SEP_RE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
  const BLOCK_TAGS = new Set([
    'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'PRE', 'OL', 'UL', 'LI', 'HR', 'BLOCKQUOTE', 'TABLE',
  ]);

  function findTables(text) {
    const lines = text.split('\n');
    const tables = [];
    const lineStart = [0];
    for (let i = 0; i < lines.length; i++) {
      lineStart.push(lineStart[i] + lines[i].length + 1);
    }
    for (let i = 0; i < lines.length - 1; i++) {
      if (!ROW_RE.test(lines[i])) continue;
      if (!SEP_RE.test(lines[i + 1])) continue;
      const headers = parseRow(lines[i]);
      const expectedCols = headers.length;
      const sepCols = parseRow(lines[i + 1]).length;
      if (sepCols !== expectedCols) continue;
      const rows = [];
      let j = i + 2;
      while (j < lines.length && ROW_RE.test(lines[j])) {
        const cells = parseRow(lines[j]);
        while (cells.length < expectedCols) cells.push('');
        if (cells.length > expectedCols) cells.length = expectedCols;
        rows.push(cells);
        j++;
      }
      if (rows.length > 0) {
        tables.push({
          headers, rows,
          charStart: lineStart[i],
          charEnd: lineStart[j - 1] + lines[j - 1].length,
        });
      }
      i = j - 1;
    }
    return tables;
  }

  // Longest contiguous ROW_RE block; bails if SEP_RE present (msg is a full table, not a continuation).
  function findContinuationRows(text) {
    const lines = text.split('\n');
    for (const ln of lines) {
      if (SEP_RE.test(ln)) return null;
    }
    let bestStart = -1, bestEnd = -1, bestCount = 0;
    let curStart = -1, curEnd = -1, curCount = 0;
    function closeBlock() {
      if (curCount > bestCount) {
        bestStart = curStart; bestEnd = curEnd; bestCount = curCount;
      }
      curStart = -1; curEnd = -1; curCount = 0;
    }
    for (let k = 0; k < lines.length; k++) {
      const ln = lines[k];
      if (ln.trim() === '') {
        if (curStart !== -1) curEnd = k;
        continue;
      }
      if (ROW_RE.test(ln)) {
        if (curStart === -1) curStart = k;
        curEnd = k;
        curCount++;
      } else {
        closeBlock();
      }
    }
    closeBlock();
    if (bestCount < 2 || bestStart < 0) return null;
    const rows = [];
    for (let k = bestStart; k <= bestEnd; k++) {
      const ln = lines[k];
      if (ln.trim() === '') continue;
      if (ROW_RE.test(ln)) rows.push(parseRow(ln));
    }
    const lineStart = [0];
    for (let k = 0; k < lines.length; k++) {
      lineStart.push(lineStart[k] + lines[k].length + 1);
    }
    return {
      rows,
      charStart: lineStart[bestStart],
      charEnd: lineStart[bestEnd] + lines[bestEnd].length,
    };
  }

  // Split-table tail: leading `|---|...` separator only; header borrowed from prev's last non-blank line.
  function findLeadingSeparatorTable(text) {
    const lines = text.split('\n');
    let sepIdx = -1;
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].trim() === '') continue;
      sepIdx = k;
      break;
    }
    if (sepIdx === -1) return null;
    const sepLine = lines[sepIdx];
    if (!SEP_RE.test(sepLine)) return null;

    const separatorCols = parseRow(sepLine).length;
    if (separatorCols === 0) return null;

    const rows = [];
    let lastRowIdx = sepIdx;
    for (let j = sepIdx + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (ln.trim() === '') continue;
      if (SEP_RE.test(ln)) break;
      if (!ROW_RE.test(ln)) break;
      const cells = parseRow(ln);
      while (cells.length < separatorCols) cells.push('');
      if (cells.length > separatorCols) cells.length = separatorCols;
      rows.push(cells);
      lastRowIdx = j;
    }

    if (rows.length === 0) return null;

    const lineStart = [0];
    for (let k = 0; k < lines.length; k++) {
      lineStart.push(lineStart[k] + lines[k].length + 1);
    }

    return {
      separatorCols,
      rows,
      charStart: lineStart[sepIdx],
      charEnd: lineStart[lastRowIdx] + lines[lastRowIdx].length,
    };
  }

  function parseRow(line) {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((c) => c.trim());
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderTableInner({ headers, rows }) {
    const thead = `<thead><tr>${headers.map((h) => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<table>${thead}${tbody}</table>`;
  }

  function renderContinuationInner(rows) {
    const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<table>${tbody}</table>`;
  }

  // Phantom \n at block boundaries keeps char offsets aligned with the table parser.
  function buildVisibleTextMap(root) {
    let text = '';
    const nodeMap = [];
    function maybeNewline() {
      if (text.length > 0 && !text.endsWith('\n')) text += '\n';
    }
    function walk(node) {
      if (node.nodeType === 3) {
        const len = node.nodeValue.length;
        nodeMap.push({ node, start: text.length, end: text.length + len });
        text += node.nodeValue;
        return;
      }
      if (node.nodeType !== 1) return;
      const cls = (node.className && node.className.toString && node.className.toString()) || '';
      if (cls.includes('hiddenVisually') ||
          cls.includes('md-table-original-hidden') ||
          cls.includes('md-table-rendered') ||
          cls.includes('md-inline-original-hidden') ||
          cls.includes('md-inline-rendered')) return;
      const tag = node.tagName;
      if (tag === 'BR') { text += '\n'; return; }
      // Discord renders some emojis (✅❌ etc.) as <img class="emoji" alt="…">.
      // Without this, emoji-only table cells parse as "".
      if (tag === 'IMG' && node.alt) {
        const alt = node.alt;
        nodeMap.push({ node, start: text.length, end: text.length + alt.length, isElement: true });
        text += alt;
        return;
      }
      const isBlock = BLOCK_TAGS.has(tag);
      if (isBlock) maybeNewline();
      for (const child of node.childNodes) walk(child);
      if (isBlock) maybeNewline();
    }
    walk(root);
    return { text, nodeMap };
  }

  // hiddenClass keeps table-pass and inline-pass cleanup independent.
  function hideRange(nodeMap, charStart, charEnd, hiddenClass) {
    if (nodeMap.length === 0) return null;
    let startEntry = null, endEntry = null;
    for (const e of nodeMap) {
      if (startEntry === null && charStart < e.end) startEntry = e;
      if (charEnd <= e.end) { endEntry = e; break; }
    }
    if (!endEntry) endEntry = nodeMap[nodeMap.length - 1];
    if (!startEntry) return null;
    const range = document.createRange();
    try {
      // Element entries (img.alt synthetic) can't take offsets; use boundary-by-node setters.
      if (startEntry.isElement) range.setStartBefore(startEntry.node);
      else range.setStart(startEntry.node, charStart - startEntry.start);
      if (endEntry.isElement) range.setEndAfter(endEntry.node);
      else range.setEnd(endEntry.node, Math.min(charEnd - endEntry.start, endEntry.node.nodeValue.length));
    } catch (e) {
      return null;
    }
    const fragment = range.extractContents();
    const wrapper = document.createElement('span');
    wrapper.className = hiddenClass || HIDDEN_TABLE_CLASS;
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);
    range.detach();
    return wrapper;
  }

  function findPreviousMessageContent(el) {
    const all = document.querySelectorAll('[id^="message-content-"]');
    const idx = Array.prototype.indexOf.call(all, el);
    if (idx <= 0) return null;
    return all[idx - 1];
  }

  // Follower messages lack their own header; walk back to the group leader.
  function extractAuthorFromItem(item) {
    if (!item) return null;
    // `img[alt]` alone also matched inline emoji <img>; require avatar class.
    const avatar = item.querySelector('img[class*="avatar"][alt]');
    if (avatar && avatar.alt) {
      const alt = avatar.alt.trim();
      if (alt) return 'a:' + alt.toLowerCase();
    }
    const usernameSpan = item.querySelector('h3 [class*="username"]');
    if (usernameSpan && usernameSpan.textContent) {
      const u = usernameSpan.textContent.trim();
      if (u) return 'u:' + u.toLowerCase();
    }
    const usernameEl = item.querySelector('[id^="message-username-"]');
    if (usernameEl && usernameEl.textContent) {
      const u = usernameEl.textContent.trim();
      if (u) return 'u:' + u.toLowerCase();
    }
    return null;
  }

  function getAuthorSignal(content) {
    if (!content) return null;
    let item = content;
    for (let i = 0; i < 10; i++) {
      if (!item || !item.parentNode) break;
      if (item.tagName === 'LI' && item.id && item.id.startsWith('chat-messages-')) break;
      if (item.tagName === 'LI') break;
      item = item.parentNode;
    }
    if (!item || item === document) return null;
    let sig = extractAuthorFromItem(item);
    if (sig) return sig;
    let prev = item.previousElementSibling;
    for (let i = 0; i < 50 && prev; i++) {
      if (prev.tagName === 'LI') {
        sig = extractAuthorFromItem(prev);
        if (sig) return sig;
      }
      prev = prev.previousElementSibling;
    }
    return null;
  }

  function sameAuthor(prev, cur) {
    const a = getAuthorSignal(prev);
    const b = getAuthorSignal(cur);
    if (!a || !b) return false;
    return a === b;
  }

  // Excludes synthesized split-tables; they're owned by a later msg's merge, not prev's own state.
  function getPreviousTableColumnCount(prev) {
    if (!prev) return null;
    const tables = prev.querySelectorAll(`.md-table-rendered[${COLS_ATTR}]:not([${SPLIT_TABLE_ATTR}])`);
    if (tables.length === 0) return null;
    const last = tables[tables.length - 1];
    const cols = parseInt(last.getAttribute(COLS_ATTR), 10);
    return Number.isFinite(cols) && cols > 0 ? cols : null;
  }

  // Walk back through the merged-into chain to the message that actually holds the
  // rendered table. Enables 3+ message splits to keep linking: the immediate prev
  // may have merged its own rows into an earlier owner and thus own no table itself.
  function resolveTableOwner(prev) {
    let owner = prev;
    for (let i = 0; i < 50 && owner; i++) {
      if (owner.querySelector(`.md-table-rendered[${COLS_ATTR}]:not([${SPLIT_TABLE_ATTR}])`)) return owner;
      const into = owner.getAttribute(MERGED_INTO_ATTR);
      if (!into) return null;
      owner = document.getElementById(into);
    }
    return null;
  }

  function restoreBridgeHiddenFragments(prev) {
    if (!prev) return;
    prev.querySelectorAll(`[${BRIDGE_HIDDEN_ATTR}]`).forEach((w) => {
      const parent = w.parentNode;
      if (!parent) return;
      while (w.firstChild) parent.insertBefore(w.firstChild, w);
      parent.removeChild(w);
    });
  }

  // Bridge reassembly: prev's mid-cell tail + current's mid-cell head → one row.
  function findBridgePartialRow(prevText, currentText, prevCols, cont) {
    if (!prevText || !currentText || !cont) return null;
    const prevLines = prevText.split('\n');
    let prevTailIdx = -1;
    for (let k = prevLines.length - 1; k >= 0; k--) {
      if (prevLines[k].trim() !== '') { prevTailIdx = k; break; }
    }
    if (prevTailIdx === -1) return null;
    const prevTail = prevLines[prevTailIdx];
    const prevTailTrim = prevTail.trim();
    if (!prevTailTrim.startsWith('|')) return null;
    if (prevTailTrim.endsWith('|')) return null;

    const currentLines = currentText.split('\n');
    let currentHeadIdx = -1;
    for (let k = 0; k < currentLines.length; k++) {
      if (currentLines[k].trim() !== '') { currentHeadIdx = k; break; }
    }
    if (currentHeadIdx === -1) return null;
    const currentHead = currentLines[currentHeadIdx];
    const currentHeadTrim = currentHead.trim();
    if (currentHeadTrim.startsWith('|')) return null;
    if (!currentHeadTrim.endsWith('|')) return null;

    const reconstructed = prevTailTrim + currentHeadTrim;
    if (!ROW_RE.test(reconstructed)) return null;
    const row = parseRow(reconstructed);
    if (row.length !== prevCols) return null;

    const prevLineStart = [0];
    for (let k = 0; k < prevLines.length; k++) {
      prevLineStart.push(prevLineStart[k] + prevLines[k].length + 1);
    }
    const currentLineStart = [0];
    for (let k = 0; k < currentLines.length; k++) {
      currentLineStart.push(currentLineStart[k] + currentLines[k].length + 1);
    }
    return {
      row,
      prevHeadStart: prevLineStart[prevTailIdx],
      prevHeadEnd: prevLineStart[prevTailIdx] + prevTail.length,
      currentTailStart: currentLineStart[currentHeadIdx],
      currentTailEnd: currentLineStart[currentHeadIdx] + currentHead.length,
    };
  }

  // Synthesized split-tables removed whole; appended-row tables just clear merge attrs.
  function rollbackMergeFor(currentId, prev) {
    if (!prev || !currentId) return;
    const escId = cssEscape(currentId);
    prev.querySelectorAll(`tr[${MERGED_ROW_ATTR}="${escId}"]`).forEach((tr) => tr.remove());
    // Reverse any tail-fill this message applied to a pre-existing owner row: clear the
    // last N cells back to empty so the row returns to its pre-fill state.
    prev.querySelectorAll(`tr[${TAIL_FILLED_BY_ATTR}="${escId}"]`).forEach((tr) => {
      const n = parseInt(tr.getAttribute(TAIL_FILL_COUNT_ATTR), 10) || 0;
      const tds = tr.querySelectorAll('td');
      for (let k = tds.length - n; k < tds.length; k++) { if (tds[k]) tds[k].textContent = ''; }
      tr.removeAttribute(TAIL_FILLED_BY_ATTR);
      tr.removeAttribute(TAIL_FILL_COUNT_ATTR);
    });
    prev.querySelectorAll(`.md-table-rendered[${MERGED_WITH_ATTR}="${escId}"]`).forEach((t) => {
      if (t.hasAttribute(SPLIT_TABLE_ATTR)) {
        t.remove();
      } else {
        t.removeAttribute(MERGED_WITH_ATTR);
        t.removeAttribute(MERGED_ROW_COUNT_ATTR);
        t.removeAttribute(BRIDGE_ATTR);
      }
    });
  }

  // Runs after the table pass. Skips single-*/-_ italic (clashes with file-path globs) + inline code / blockquote / spoiler (Discord renders).
  function findInlinePatterns(text) {
    const found = [];
    if (!text) return found;
    const occupied = new Array(text.length).fill(false);
    function isFree(s, e) {
      for (let i = s; i < e; i++) if (occupied[i]) return false;
      return true;
    }
    function occupy(s, e) {
      for (let i = s; i < e; i++) occupied[i] = true;
    }
    function tryAdd(s, e, payload) {
      if (s < 0 || e > text.length || s >= e) return;
      if (!isFree(s, e)) return;
      occupy(s, e);
      found.push(Object.assign({ start: s, end: e }, payload));
    }

    const headingRe = /(?:^|\n)([ \t]*)(#{1,3})[ \t]+([^\n]+?)[ \t]*(?=\n|$)/g;
    let m;
    while ((m = headingRe.exec(text)) !== null) {
      const lineOffset = m.index === 0 && text[0] !== '\n' ? 0 : 1;
      const s = m.index + lineOffset;
      tryAdd(s, s + m[0].length - lineOffset, {
        type: 'heading', level: m[2].length, content: m[3],
      });
    }

    const hrRe = /(?:^|\n)([ \t]*-{3,}[ \t]*)(?=\n|$)/g;
    while ((m = hrRe.exec(text)) !== null) {
      const lineOffset = m.index === 0 && text[0] !== '\n' ? 0 : 1;
      const s = m.index + lineOffset;
      tryAdd(s, s + m[1].length, { type: 'hr' });
    }

    // Longer markers (***) before shorter (**).
    function scanInline(re, type, contentGroup) {
      let mm;
      re.lastIndex = 0;
      while ((mm = re.exec(text)) !== null) {
        const s = mm.index;
        const e = s + mm[0].length;
        tryAdd(s, e, { type, content: mm[contentGroup] });
      }
    }
    scanInline(/\*\*\*([^*\n]+?)\*\*\*/g, 'bold-italic', 1);
    scanInline(/\*\*([^*\n]+?)\*\*/g, 'bold', 1);
    scanInline(/~~([^~\n]+?)~~/g, 'strike', 1);
    scanInline(/__([^_\n]+?)__/g, 'underline', 1);

    return found;
  }

  function renderInlinePattern(p) {
    let el;
    if (p.type === 'hr') {
      el = document.createElement('hr');
    } else if (p.type === 'heading') {
      el = document.createElement(`h${Math.min(Math.max(p.level, 1), 3)}`);
      el.classList.add('md-heading', `md-heading-${p.level}`);
      el.textContent = p.content;
    } else if (p.type === 'bold') {
      el = document.createElement('strong');
      el.textContent = p.content;
    } else if (p.type === 'bold-italic') {
      el = document.createElement('strong');
      const inner = document.createElement('em');
      inner.classList.add('md-inline-rendered');
      inner.textContent = p.content;
      el.appendChild(inner);
    } else if (p.type === 'strike') {
      el = document.createElement('s');
      el.textContent = p.content;
    } else if (p.type === 'underline') {
      el = document.createElement('u');
      el.textContent = p.content;
    } else {
      return null;
    }
    el.classList.add('md-inline-rendered');
    return el;
  }

  // Multi-line inline tags are Discord parser overruns; unwrap. <pre> excluded.
  const BROKEN_INLINE_TAGS = new Set(['CODE', 'EM', 'STRONG', 'U', 'S']);
  function normalizeBrokenInlines(el) {
    if (!el) return;
    if (el.hasAttribute(NORMALIZED_ATTR)) return;
    const candidates = el.querySelectorAll('code, em, strong, u, s');
    for (const node of candidates) {
      if (!BROKEN_INLINE_TAGS.has(node.tagName)) continue;
      if (node.classList && node.classList.contains('md-inline-rendered')) continue;
      if (node.closest && node.closest('pre')) continue;
      const text = node.textContent || '';
      if (!text.includes('\n')) continue;
      const parent = node.parentNode;
      if (!parent) continue;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    }
    el.setAttribute(NORMALIZED_ATTR, '1');
  }

  function processInlinePatterns(el) {
    if (!el) return;
    if (el.hasAttribute(INLINE_MARK_ATTR)) {
      const expected = parseInt(el.getAttribute(INLINE_MARK_ATTR), 10);
      if (Number.isFinite(expected)) {
        const actual = el.querySelectorAll('.md-inline-rendered').length;
        if (actual === expected) return;
      }
    }
    el.querySelectorAll('.md-inline-rendered').forEach((n) => n.remove());
    el.querySelectorAll(`.${HIDDEN_INLINE_CLASS}`).forEach((w) => {
      const parent = w.parentNode;
      if (!parent) return;
      while (w.firstChild) parent.insertBefore(w.firstChild, w);
      parent.removeChild(w);
    });

    const { text, nodeMap } = buildVisibleTextMap(el);
    const patterns = findInlinePatterns(text);
    if (patterns.length === 0) {
      el.setAttribute(INLINE_MARK_ATTR, '0');
      return;
    }
    // Tail-first so earlier nodeMap entries stay valid through DOM mutations.
    patterns.sort((a, b) => b.start - a.start);
    let count = 0;
    for (const p of patterns) {
      const wrapper = hideRange(nodeMap, p.start, p.end, HIDDEN_INLINE_CLASS);
      if (!wrapper || !wrapper.parentNode) continue;
      const rendered = renderInlinePattern(p);
      if (!rendered) continue;
      wrapper.parentNode.insertBefore(rendered, wrapper.nextSibling);
      count++;
    }
    el.setAttribute(INLINE_MARK_ATTR, String(count));
  }

  function processMessage(el) {
    // Quick-return: validate both own-tables count AND merge state (legacy MERGED_VALUE → expectedOwn=0).
    if (el.hasAttribute(MARK_ATTR)) {
      const val = el.getAttribute(MARK_ATTR);
      const expectedOwn = val === MERGED_VALUE ? 0 : parseInt(val, 10);
      if (Number.isFinite(expectedOwn)) {
        // Exclude split-tables; owned by neighbour's merge, not own state.
        const actualOwn = el.querySelectorAll(`.md-table-rendered:not([${SPLIT_TABLE_ATTR}])`).length;
        if (actualOwn === expectedOwn) {
          const mergedInto = el.getAttribute(MERGED_INTO_ATTR);
          if (!mergedInto) return; // no merge expected, state intact
          // Chain-aware: our rows live in the owner named by MERGED_INTO_ATTR, which may
          // be several messages back (3+ msg split), not the immediate prev. Verify by our
          // own per-message row tag rather than the owner's last-writer MERGED_WITH attr; 
          // the latter gets overwritten by later merges and would falsely fail here (→ ping-pong).
          const ownerForCheck = document.getElementById(mergedInto);
          if (ownerForCheck && ownerForCheck.querySelector(`tr[${MERGED_ROW_ATTR}="${el.id}"]`)) {
            return; // merge still intact
          }
          // merge state lost (React re-rendered owner); fall through to rebuild
        }
      }
    }

    el.querySelectorAll('.md-table-original-hidden').forEach((w) => {
      const parent = w.parentNode;
      while (w.firstChild) parent.insertBefore(w.firstChild, w);
      parent.removeChild(w);
    });
    el.querySelectorAll(`.md-table-rendered:not([${SPLIT_TABLE_ATTR}])`).forEach((n) => n.remove());
    // Drop inline residue; its wrappers anchor to nodes the table pass re-arranges.
    el.querySelectorAll('.md-inline-rendered').forEach((n) => n.remove());
    el.querySelectorAll(`.${HIDDEN_INLINE_CLASS}`).forEach((w) => {
      const parent = w.parentNode;
      if (!parent) return;
      while (w.firstChild) parent.insertBefore(w.firstChild, w);
      parent.removeChild(w);
    });
    el.removeAttribute(INLINE_MARK_ATTR);
    // Force re-normalize; React may have re-rendered and brought overruns back.
    el.removeAttribute(NORMALIZED_ATTR);
    normalizeBrokenInlines(el);

    const previouslyMergedInto = el.getAttribute(MERGED_INTO_ATTR);
    if (previouslyMergedInto) {
      // Chain-aware: owner may be several messages back, not the immediate prev.
      const ownerForCleanup = document.getElementById(previouslyMergedInto);
      if (ownerForCleanup) {
        rollbackMergeFor(el.id, ownerForCleanup);
        // Only restore the owner's bridge fragments when this message's merge was the
        // adjacent one that created them. In a chain the owner's bridge belongs to an
        // earlier, still-valid merge and must stay hidden (else its text orphans back).
        if (ownerForCleanup === findPreviousMessageContent(el)) {
          restoreBridgeHiddenFragments(ownerForCleanup);
        }
      }
      el.removeAttribute(MERGED_INTO_ATTR);
    }
    const { text, nodeMap } = buildVisibleTextMap(el);
    if (!text.includes('|')) {
      el.setAttribute(MARK_ATTR, '0');
      return;
    }

    // A continuation prefix can co-exist with own tables (an earlier build handled it only when there were no own tables).
    const tables = findTables(text);
    const firstTableStart = tables.length > 0 ? tables[0].charStart : text.length;
    const prefixText = firstTableStart > 0 ? text.substring(0, firstTableStart) : '';
    const cont = prefixText ? findContinuationRows(prefixText) : null;

    let contFallbackRendered = false;
    let bridgeWrapper = null;
    let bridgeApplied = false;

    if (cont) {
      const prev = findPreviousMessageContent(el);
      const owner = resolveTableOwner(prev);
      const prevCols = getPreviousTableColumnCount(owner);
      if (prev !== null && owner !== null && prevCols !== null && sameAuthor(prev, el)) {
        const colCounts = cont.rows.map((r) => r.length);
        if (colCounts.every((c) => c === prevCols)) {
          // Bridge (mid-row reassembly) only applies to the directly-adjacent owner. In a
          // 3+ message chain the immediate prev is already merged away (owner is further
          // back), so there is no clean adjacent tail to bridge; merge whole rows instead.
          // Only restore (un-hide) the owner's bridge fragments when we are about to RE-DO
          // that bridge (adjacent case). In the chained case the owner's existing bridge
          // belongs to an earlier, still-valid merge; un-hiding it would orphan that text
          // back into view.
          let bridge = null;
          let prevMap = null;
          if (owner === prev) {
            restoreBridgeHiddenFragments(prev);
            prevMap = buildVisibleTextMap(prev);
            bridge = findBridgePartialRow(prevMap.text, text, prevCols, cont);
          }

          // Tail-fill (non-adjacent split): a leading partial-row fragment in this message
          // (no leading '|', ends with '|') whose cells exactly fill the trailing EMPTY cells
          // of the owner's current last row; a row split across a boundary the adjacent
          // text-bridge can't reach (3-msg split). Reversible via TAIL_FILLED_BY_ATTR.
          let tailFill = null;
          {
            const beforeCont = text.substring(0, cont.charStart);
            const bLines = beforeCont.split('\n');
            let li = -1;
            for (let k = bLines.length - 1; k >= 0; k--) { if (bLines[k].trim() !== '') { li = k; break; } }
            if (li !== -1) {
              const frag = bLines[li].trim();
              if (frag && !frag.startsWith('|') && frag.endsWith('|')) {
                const cells = frag.slice(0, -1).split('|').map((c) => c.trim());
                let lineStart = 0;
                for (let k = 0; k < li; k++) lineStart += bLines[k].length + 1;
                tailFill = { cells, lineStart };
              }
            }
          }

          let rows = cont.rows;
          let currentHideStart = cont.charStart;
          if (bridge) tailFill = null; // adjacency handled by the text-bridge; don't double-process
          if (bridge) {
            bridgeWrapper = hideRange(prevMap.nodeMap, bridge.prevHeadStart, bridge.prevHeadEnd);
            if (bridgeWrapper) {
              bridgeWrapper.setAttribute(BRIDGE_HIDDEN_ATTR, 'true');
              rows = [bridge.row, ...cont.rows];
              currentHideStart = bridge.currentTailStart;
              bridgeApplied = true;
            }
          }

          // Last rendered table on the owner; matches getPreviousTableColumnCount; cols re-check guards state drift.
          const prevTablesAll = owner.querySelectorAll(`.md-table-rendered[${COLS_ATTR}]:not([${SPLIT_TABLE_ATTR}])`);
          const prevTable = prevTablesAll.length > 0 ? prevTablesAll[prevTablesAll.length - 1] : null;
          const prevTableCols = prevTable ? parseInt(prevTable.getAttribute(COLS_ATTR), 10) : null;

          const rollbackBridge = () => {
            if (bridgeWrapper && bridgeWrapper.parentNode) {
              const p = bridgeWrapper.parentNode;
              while (bridgeWrapper.firstChild) p.insertBefore(bridgeWrapper.firstChild, bridgeWrapper);
              p.removeChild(bridgeWrapper);
              bridgeWrapper = null;
            }
          };

          if (prevTable && prevTableCols === prevCols) {
            const prevTbody = prevTable.querySelector('tbody');
            if (prevTbody) {
              // Build fragment in memory before mutating prev; transaction shape.
              const fragment = document.createDocumentFragment();
              for (const row of rows) {
                const tr = document.createElement('tr');
                tr.setAttribute(MERGED_ROW_ATTR, el.id);
                for (const cell of row) {
                  const td = document.createElement('td');
                  td.textContent = cell;
                  tr.appendChild(td);
                }
                fragment.appendChild(tr);
              }
              // Plan tail-fill against the owner's CURRENT last row (before appending ours).
              let fillPlan = null;
              if (tailFill) {
                const ownerLastRow = prevTbody.lastElementChild;
                if (ownerLastRow) {
                  const tds = ownerLastRow.querySelectorAll('td');
                  let emptyCount = 0;
                  for (let k = tds.length - 1; k >= 0 && tds[k].textContent === ''; k--) emptyCount++;
                  if (tds.length === prevCols && emptyCount > 0 && emptyCount === tailFill.cells.length) {
                    fillPlan = { row: ownerLastRow, tds, startIdx: tds.length - emptyCount };
                  }
                }
              }
              // When filling, extend the hide to also cover the orphan tail-fragment text.
              const hideStart = fillPlan ? tailFill.lineStart : currentHideStart;
              const currentWrapper = hideRange(nodeMap, hideStart, cont.charEnd);
              if (currentWrapper) {
                prevTbody.appendChild(fragment);
                prevTable.setAttribute(MERGED_WITH_ATTR, el.id);
                prevTable.setAttribute(MERGED_ROW_COUNT_ATTR, String(rows.length));
                if (bridgeApplied) prevTable.setAttribute(BRIDGE_ATTR, 'true');
                el.setAttribute(MERGED_INTO_ATTR, owner.id);
                if (fillPlan) {
                  for (let k = 0; k < tailFill.cells.length; k++) fillPlan.tds[fillPlan.startIdx + k].textContent = tailFill.cells[k];
                  fillPlan.row.setAttribute(TAIL_FILLED_BY_ATTR, el.id);
                  fillPlan.row.setAttribute(TAIL_FILL_COUNT_ATTR, String(tailFill.cells.length));
                }
              } else {
                rollbackBridge();
              }
            } else {
              // Headerless fallback: prev has cols but no usable tbody.
              const wrapper = hideRange(nodeMap, currentHideStart, cont.charEnd);
              const tableNode = document.createElement('div');
              tableNode.className = 'md-table-rendered';
              tableNode.setAttribute(COLS_ATTR, String(prevCols));
              tableNode.setAttribute(CONT_ATTR, 'true');
              if (bridgeApplied) tableNode.setAttribute(BRIDGE_ATTR, 'true');
              tableNode.innerHTML = renderContinuationInner(rows);
              if (wrapper && wrapper.parentNode) {
                wrapper.parentNode.insertBefore(tableNode, wrapper.nextSibling);
              } else {
                el.appendChild(tableNode);
              }
              contFallbackRendered = true;
            }
          } else {
            // prevTable absent or cols mismatch: leave raw markdown visible.
            rollbackBridge();
          }
        }
      }
    }

    // Split-table tail; mutually exclusive with cont (cont bails on SEP_RE).
    if (!cont) {
      const splitTail = findLeadingSeparatorTable(text);
      if (splitTail) {
        const prev = findPreviousMessageContent(el);
        if (prev && sameAuthor(prev, el)) {
          restoreBridgeHiddenFragments(prev);
          const prevMap = buildVisibleTextMap(prev);
          const prevLines = prevMap.text.split('\n');
          let prevTailIdx = -1;
          for (let k = prevLines.length - 1; k >= 0; k--) {
            if (prevLines[k].trim() !== '') { prevTailIdx = k; break; }
          }
          if (prevTailIdx !== -1) {
            const prevTailLine = prevLines[prevTailIdx];
            if (ROW_RE.test(prevTailLine) && !SEP_RE.test(prevTailLine)) {
              const headerCells = parseRow(prevTailLine);
              if (headerCells.length === splitTail.separatorCols) {
                const prevLineStart = [0];
                for (let k = 0; k < prevLines.length; k++) {
                  prevLineStart.push(prevLineStart[k] + prevLines[k].length + 1);
                }
                const prevHeaderStart = prevLineStart[prevTailIdx];
                const prevHeaderEnd = prevLineStart[prevTailIdx] + prevTailLine.length;

                const prevHeaderWrapper = hideRange(prevMap.nodeMap, prevHeaderStart, prevHeaderEnd);
                if (prevHeaderWrapper) {
                  prevHeaderWrapper.setAttribute(BRIDGE_HIDDEN_ATTR, 'true');
                  const currentWrapper = hideRange(nodeMap, splitTail.charStart, splitTail.charEnd);
                  if (currentWrapper) {
                    const tableNode = document.createElement('div');
                    tableNode.className = 'md-table-rendered';
                    tableNode.setAttribute(COLS_ATTR, String(splitTail.separatorCols));
                    tableNode.setAttribute(MERGED_WITH_ATTR, el.id);
                    tableNode.setAttribute(MERGED_ROW_COUNT_ATTR, String(splitTail.rows.length));
                    tableNode.setAttribute(SPLIT_TABLE_ATTR, 'true');
                    tableNode.innerHTML = renderTableInner({ headers: headerCells, rows: splitTail.rows });
                    if (prevHeaderWrapper.parentNode) {
                      prevHeaderWrapper.parentNode.insertBefore(tableNode, prevHeaderWrapper.nextSibling);
                    } else {
                      prev.appendChild(tableNode);
                    }
                    el.setAttribute(MERGED_INTO_ATTR, prev.id);
                  } else {
                    const p = prevHeaderWrapper.parentNode;
                    while (prevHeaderWrapper.firstChild) p.insertBefore(prevHeaderWrapper.firstChild, prevHeaderWrapper);
                    p.removeChild(prevHeaderWrapper);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Back-to-front so earlier hides don't shift later offsets; cont hide above is at charStart < tables[0].charStart so nodeMap entries here are still valid.
    if (tables.length > 0) {
      const sorted = tables.slice().sort((a, b) => b.charStart - a.charStart);
      for (const t of sorted) {
        const wrapper = hideRange(nodeMap, t.charStart, t.charEnd);
        const tableNode = document.createElement('div');
        tableNode.className = 'md-table-rendered';
        tableNode.setAttribute(COLS_ATTR, String(t.headers.length));
        tableNode.innerHTML = renderTableInner(t);
        if (wrapper && wrapper.parentNode) {
          wrapper.parentNode.insertBefore(tableNode, wrapper.nextSibling);
        } else {
          el.appendChild(tableNode);
        }
      }
    }

    // MARK_ATTR = own-table count (own + fallback); merge state lives in MERGED_INTO_ATTR independently.
    el.setAttribute(MARK_ATTR, String(tables.length + (contFallbackRendered ? 1 : 0)));
  }

  function findMessageContents(root) {
    const fromId = root.querySelectorAll('[id^="message-content-"]');
    if (fromId.length > 0) return fromId;
    return root.querySelectorAll('[class*="markup__"]');
  }

  function scan(root = document.body) {
    if (!root || root.nodeType !== 1) return;
    findMessageContents(root).forEach((el) => {
      normalizeBrokenInlines(el);
      processMessage(el);
      processInlinePatterns(el);
    });
  }

  scan();

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    const fn = () => { scanScheduled = false; scan(document.body); };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 200 });
    } else {
      setTimeout(fn, 50);
    }
  }

  // Skip scans for input typing, sidebar, reaction pickers, modals; only message-list mutations matter.
  function isInputAreaTarget(target) {
    const start = target && target.nodeType === 1 ? target : (target && target.parentNode);
    let cur = start;
    for (let i = 0; i < 20 && cur && cur.nodeType === 1; i++) {
      const ce = cur.getAttribute && cur.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return true;
      const role = cur.getAttribute && cur.getAttribute('role');
      if (role === 'textbox') return true;
      cur = cur.parentNode;
    }
    return false;
  }
  function targetInMessageArea(target) {
    let cur = target && target.nodeType === 1 ? target : (target && target.parentNode);
    for (let i = 0; i < 25 && cur && cur.nodeType === 1; i++) {
      if (cur.id) {
        if (cur.id.startsWith('message-content-')) return true;
        if (cur.id.startsWith('chat-messages-')) return true;
      }
      if (cur.getAttribute && cur.getAttribute('data-list-id') === 'chat-messages') return true;
      cur = cur.parentNode;
    }
    return false;
  }
  function addedNodesContainMessage(addedNodes) {
    if (!addedNodes || addedNodes.length === 0) return false;
    for (const n of addedNodes) {
      if (!n || n.nodeType !== 1) continue;
      if (n.id && (n.id.startsWith('message-content-') || n.id.startsWith('chat-messages-'))) return true;
      if (n.querySelector && n.querySelector('[id^="message-content-"]')) return true;
    }
    return false;
  }
  function mutationIsRelevant(m) {
    if (isInputAreaTarget(m.target)) return false;
    if (targetInMessageArea(m.target)) return true;
    if (addedNodesContainMessage(m.addedNodes)) return true;
    return false;
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (mutationIsRelevant(m)) {
        scheduleScan();
        return;
      }
    }
  });
  observer.observe(document.body, {
    childList: true, subtree: true,
    // characterData NOT observed: fires on every keystroke in message input.
  });
  // Safety scan covers SPA route changes that don't trigger childList.
  const intervalId = setInterval(scheduleScan, 2000);

  window.__discordMdTable = { version: VERSION, observer, intervalId };

  console.log(`[discord-markdown-renderer] injected v${VERSION}`);
})();
