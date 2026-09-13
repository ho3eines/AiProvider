/**
 * رندرکننده مارک‌داون سبک و امن (بدون کتابخانه خارجی)
 *
 * امنیت: قبل از هر درج، متن escape می‌شود (و < > " ') تا XSS ممکن نباشد.
 * بلوک‌های کد ابتدا استخراج و با placeholder جایگزین می‌شوند تا محتوایشان
 * پردازش مارک‌داونی نشود؛ سپس با هایلایت سینتکس برگردانده می‌شوند.
 */

/* ---------- ذخیره کد بلوک‌ها برای دکمه «کپی» ---------- */
const codeStore = new Map<string, string>();
let codeCounter = 0;
const MAX_STORE = 80;

function registerCode(code: string): string {
  const id = 'cb' + ++codeCounter;
  codeStore.set(id, code);
  if (codeStore.size > MAX_STORE) {
    const first = codeStore.keys().next().value;
    if (first !== undefined) codeStore.delete(first);
  }
  return id;
}

export function getCodeById(id: string): string | null {
  return codeStore.get(id) ?? null;
}

/* ---------- escape امن HTML ---------- */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- هایلایت سینتکس ساده: کلیدواژه/رشته/عدد/کامنت ---------- */
const KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'elif', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'default', 'class', 'extends', 'new', 'this', 'self', 'super',
  'import', 'export', 'from', 'as', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw',
  'raise', 'except', 'typeof', 'instanceof', 'delete', 'in', 'of', 'not', 'and', 'or', 'is', 'with',
  'def', 'pass', 'lambda', 'print', 'True', 'False', 'None', 'true', 'false', 'null', 'undefined',
  'void', 'int', 'float', 'str', 'bool', 'public', 'private', 'static', 'struct', 'enum',
  'interface', 'type', 'func', 'fn', 'impl', 'match', 'use', 'mut', 'pub', 'end', 'then',
];

const HASH_COMMENT_LANGS = /^(py|python|rb|ruby|sh|bash|zsh|shell|yml|yaml|toml|ini|conf|config|makefile|dockerfile|r|pl|perl)$/i;

export function highlightCode(code: string, lang: string): string {
  const hashComment = HASH_COMMENT_LANGS.test(lang.trim());
  const commentPart = hashComment
    ? '(#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)'
    : '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)';
  const re = new RegExp(
    commentPart +
      "|('(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|`(?:\\\\.|[^`\\\\])*`)" +
      '|\\b(\\d+(?:\\.\\d+)?)\\b' +
      '|\\b(' + KEYWORDS.join('|') + ')\\b',
    'g'
  );
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    if (m[1]) out += '<span class="tok-comment">' + escapeHtml(m[1]) + '</span>';
    else if (m[2]) out += '<span class="tok-string">' + escapeHtml(m[2]) + '</span>';
    else if (m[3]) out += '<span class="tok-number">' + escapeHtml(m[3]) + '</span>';
    else out += '<span class="tok-keyword">' + escapeHtml(m[4]) + '</span>';
    last = m.index + m[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/* ---------- ساخت HTML بلوک کد با هدر زبان + دکمه کپی ---------- */
function codeBlockHtml(lang: string, code: string): string {
  const id = registerCode(code);
  const shownLang = escapeHtml(lang || 'code');
  return (
    '<div class="md-code" dir="ltr">' +
    '<div class="md-code-head"><span class="md-code-lang">' + shownLang + '</span>' +
    '<button type="button" class="md-code-copy" data-code-id="' + id + '">کپی</button>' +
    '</div>' +
    '<pre class="md-pre"><code>' + highlightCode(code, lang) + '</code></pre>' +
    '</div>'
  );
}

/* ---------- پردازش inline: لینک/بولد/ایتالیک/خط‌خورده ---------- */
function inlineFormat(s: string): string {
  let out = s;
  // لینک [متن](https://…) — فقط http/https برای امنیت
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );
  // بولد **…**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // ایتالیک *…*
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // خط‌خورده ~~…~~
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

/**
 * تبدیل مارک‌داون به HTML امن
 * مراحل: استخراج بلوک کد → escape → کد اینلاین → پردازش بلاکی → بازگردانی placeholder ها
 */
export function renderMarkdown(src: string): string {
  if (!src) return '';

  /* ۱) استخراج بلوک‌های کد (حتی اگر در حین استریم هنوز بسته نشده باشند) */
  const codeBlocks: Array<{ lang: string; code: string }> = [];
  let text = src.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (_all, langLine: string, code: string) => {
    codeBlocks.push({ lang: (langLine || '').trim().split(/\s+/)[0] || '', code });
    return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
  });

  /* ۲) escape کل متن — قبل از هر درج تگ */
  text = escapeHtml(text);

  /* ۳) کد اینلاین `…` → placeholder */
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_all, c: string) => {
    inlineCodes.push(c);
    return '\u0000IC' + (inlineCodes.length - 1) + '\u0000';
  });

  /* ۴) پردازش بلاکی خط‌به‌خط */
  const lines = text.split('\n');
  const html: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!para.length) return;
    html.push('<p class="md-p">' + para.map(inlineFormat).join('<br/>') + '</p>');
    para = [];
  };
  const closeList = () => {
    if (!list) return;
    html.push(
      '<' + list.type + ' class="md-list">' +
      list.items.map((it) => '<li>' + inlineFormat(it) + '</li>').join('') +
      '</' + list.type + '>'
    );
    list = null;
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // placeholder بلوک کد در خط مستقل
    const cb = trimmed.match(/^\u0000CB(\d+)\u0000$/);
    if (cb) {
      flushParagraph();
      closeList();
      const b = codeBlocks[Number(cb[1])];
      html.push(b ? codeBlockHtml(b.lang, b.code) : '');
      i++;
      continue;
    }

    // خط خالی
    if (!trimmed) {
      flushParagraph();
      closeList();
      i++;
      continue;
    }

    // هدینگ # … ######
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushParagraph();
      closeList();
      const lv = h[1].length;
      html.push('<h' + lv + ' class="md-h">' + inlineFormat(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }

    // خط افقی --- *** ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push('<hr class="md-hr"/>');
      i++;
      continue;
    }

    // نقل‌قول > (در متن escape شده به صورت &gt;)
    if (/^(&gt;|>)\s?/.test(trimmed)) {
      flushParagraph();
      closeList();
      const quote: string[] = [];
      while (i < lines.length) {
        const m2 = lines[i].trim().match(/^(&gt;|>)\s?(.*)$/);
        if (!m2) break;
        quote.push(m2[2]);
        i++;
      }
      html.push('<blockquote class="md-quote">' + quote.map(inlineFormat).join('<br/>') + '</blockquote>');
      continue;
    }

    // لیست نامرتب - * +
    const ul = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        closeList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(ul[1]);
      i++;
      continue;
    }

    // لیست مرتب 1. 2)
    const ol = trimmed.match(/^(\d{1,3})[.)]\s+(.+)$/);
    if (ol) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        closeList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ol[2]);
      i++;
      continue;
    }

    // پاراگراف
    para.push(trimmed);
    i++;
  }
  flushParagraph();
  closeList();

  /* ۵) بازگردانی placeholder ها */
  let out = html.join('\n');
  out = out.replace(/\u0000CB(\d+)\u0000/g, (_a, n: string) => {
    const b = codeBlocks[Number(n)];
    return b ? codeBlockHtml(b.lang, b.code) : '';
  });
  out = out.replace(/\u0000IC(\d+)\u0000/g, (_a, n: string) => {
    return '<code class="md-icode">' + inlineCodes[Number(n)] + '</code>';
  });
  return out;
}

/** افزودن کرسر چشمک‌زن به انتهای HTML در حال استریم */
export function appendCursor(html: string): string {
  const cursor = '<span class="stream-cursor" aria-hidden="true"></span>';
  if (!html) return cursor;
  const idx = html.lastIndexOf('</p>');
  if (idx !== -1) return html.slice(0, idx) + cursor + html.slice(idx);
  return html + cursor;
}
