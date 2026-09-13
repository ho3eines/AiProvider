'use client';

/**
 * اپلیکیشن چت هوشمند — تک‌صفحه‌ای، RTL، تم تاریک
 * قابلیت‌ها: استریم زنده SSE، چند گفتگو با localStorage، مارک‌داون امن،
 * تفکر مدل، توقف/بازتولید/ویرایش/حذف پیام، خروجی Markdown/JSON، پنل Raw SSE
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, Bot, Brain, Check, ChevronDown, Code2, Copy, Download, FileJson, Globe, Languages, Mail, Menu,
  MessageSquare, Pencil, Plus, RotateCcw, Send, Settings, Sparkles, Square, Trash2, X, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { appendCursor, renderMarkdown, getCodeById } from '@/lib/markdown';
import { createSseParser } from '@/lib/sse';

/* ---------- انواع داده ---------- */
type Role = 'user' | 'assistant';

interface Msg {
  id: string;
  role: Role;
  content: string;
  reasoning?: string;      // متن تفکر مدل
  errorText?: string;      // متن خطا (حباب قرمز)
  isError?: boolean;       // حباب قرمز
  stopped?: boolean;       // ⏹ نیمه‌کاره رها شده
  timeSec?: number;        // آمار: زمان
  chunks?: number;         // آمار: تعداد تکه
  chars?: number;          // آمار: تعداد نویسه
  createdAt: number;
}

interface Chat {
  id: string;
  title: string;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
}

interface Settings {
  modelId: string;
  thinking: boolean;
  deepSearch: boolean;
  stream: boolean;
  systemPrompt: string;
}

/* ---------- ثابت‌ها ---------- */
/* مدل‌ها با گروه و لوگو — دقیقاً مطابق پیکر مدل سایت freemodels */
const MODELS = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'gpt-5.6-sol',      name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'gpt-5.6-terra',    name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: '/zai.png' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: '/kimi-logo-png_seeklogo-611650.png' },
];
/* گروه‌های پیکر مدل به‌ترتیب نمایش (آیکن هر گروه مثل سایت) */
const MODEL_GROUPS: Array<{ title: string; icon: LucideIcon }> = [
  { title: 'Claude Pro',       icon: Sparkles },
  { title: 'ChatGPT Pro',      icon: Zap },
  { title: 'Other Pro Models', icon: Globe },
];
const DEFAULT_SETTINGS: Settings = {
  modelId: 'claude-fable-5.1',
  thinking: false,
  deepSearch: false,
  stream: true,
  systemPrompt: '',
};
const MAX_RAW_LOG = 80 * 1024; // پنل Raw SSE: نگه‌داری آخرین ~80KB

const SUGGESTIONS = [
  { icon: Brain, title: 'توضیح مفهومی', text: 'به زبان ساده توضیح بده مدل‌های زبانی بزرگ (LLM) چطور کار می‌کنند؟' },
  { icon: Code2, title: 'کد بنویس', text: 'یک اسکریپت پایتون بنویس که پرتکرارترین کلمات یک متن را پیدا کند.' },
  { icon: Mail, title: 'ایمیل رسمی', text: 'یک ایمیل رسمی و محترمانه به مدیرم بنویس و درخواست یک روز مرخصی کن.' },
  { icon: Languages, title: 'ترجمه', text: 'این جمله را به انگلیسی روان ترجمه کن: زندگی زیباست و باید از هر لحظه لذت برد.' },
];

/* ---------- ابزارها ---------- */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem('fm_chats');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr as Chat[];
    }
  } catch {
    /* داده خراب — نادیده بگیر */
  }
  return [];
}
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('fm_settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* نادیده بگیر */
  }
  return DEFAULT_SETTINGS;
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const fmtTime = (ts: number) => new Date(ts).toLocaleDateString('fa-IR') + ' ' + new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

/* ---------- باکس تفکر مدل (جمع‌شونده) ---------- */
function ThinkingBox({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  useEffect(() => {
    setOpen(active); // در حین تفکر باز، بعد از شروع پاسخ بسته می‌شود
  }, [active]);
  return (
    <details
      className="think-box"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>💭 فرایند تفکر مدل</summary>
      <div dir="auto" className="px-3 pb-3 pt-1 text-xs leading-7 text-slate-400 whitespace-pre-wrap break-words max-h-60 overflow-y-auto chat-scroll">
        {text}
      </div>
    </details>
  );
}

/* ---------- آیتم پیام ---------- */
interface MessageItemProps {
  msg: Msg;
  live: boolean;
  isLastAssistant: boolean;
  editing: boolean;
  editingText: string;
  onEditingTextChange: (t: string) => void;
  onCopy: (m: Msg) => void;
  onEditStart: (m: Msg) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
}

const MessageItem = memo(function MessageItem(p: MessageItemProps) {
  const { msg, live } = p;
  const isUser = msg.role === 'user';

  return (
    <div className={`group flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      {/* برچسب نقش */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 px-1">
        {isUser ? <span>👤 شما</span> : (
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-md bg-gradient-to-br from-[#3b82f6] to-[#38bdf8] flex items-center justify-center">
              <Bot className="w-3 h-3 text-white" />
            </span>
            دستیار
          </span>
        )}
      </div>

      {/* حباب پیام */}
      <div
        dir="auto"
        className={
          isUser
            ? 'max-w-[88%] rounded-2xl rounded-bl-md bg-[#233457] px-4 py-3 text-[15px] leading-8 text-slate-100 whitespace-pre-wrap break-words'
            : msg.isError && !msg.content
              ? 'w-full max-w-[720px] rounded-2xl rounded-br-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-7 text-red-200 break-words'
              : 'w-full max-w-[720px] rounded-2xl rounded-br-md border border-[#243352] bg-[#111a2e] px-4 py-3 text-[15px] leading-8 text-slate-200 break-words'
        }
      >
        {/* تفکر مدل */}
        {!isUser && msg.reasoning ? <ThinkingBox text={msg.reasoning} active={live && !msg.content} /> : null}

        {/* متن پیام / ویرایش */}
        {p.editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              dir="auto"
              value={p.editingText}
              onChange={(e) => p.onEditingTextChange(e.target.value)}
              rows={Math.min(10, Math.max(2, p.editingText.split('\n').length + 1))}
              className="w-full resize-none rounded-xl border border-[#3b82f6] bg-[#0d1730] px-3 py-2 text-sm leading-7 text-slate-100 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => p.onEditSave(msg.id)}
                className="flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2563eb]"
              >
                <Check className="w-3.5 h-3.5" /> ذخیره و ارسال دوباره
              </button>
              <button
                onClick={p.onEditCancel}
                className="flex items-center gap-1.5 rounded-lg border border-[#243352] px-3 py-1.5 text-xs text-slate-300 hover:bg-[#1a2440]"
              >
                <X className="w-3.5 h-3.5" /> انصراف
              </button>
            </div>
          </div>
        ) : isUser ? (
          msg.content
        ) : msg.content ? (
          <div
            className="md-body"
            dangerouslySetInnerHTML={{ __html: live ? appendCursor(renderMarkdown(msg.content)) : renderMarkdown(msg.content) }}
          />
        ) : live ? (
          <span className="stream-cursor" aria-hidden="true" />
        ) : null}

        {/* خطای داخل پیام */}
        {!isUser && msg.errorText ? (
          <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm leading-7 text-red-200">
            {msg.errorText}
          </div>
        ) : null}

        {/* نشان توقف */}
        {!isUser && msg.stopped ? (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
            <Square className="h-3 w-3 fill-current" /> متوقف شد
          </div>
        ) : null}
      </div>

      {/* اکشن‌ها + آمار */}
      <div className="flex items-center gap-1.5 px-1 flex-wrap">
        {/* اکشن‌ها — در دسکتاپ با hover، در موبایل همیشه */}
        <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button
            aria-label="کپی پیام"
            title="کپی"
            onClick={() => p.onCopy(msg)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#243352] bg-[#111a2e] text-slate-400 transition-colors hover:border-[#3b82f6] hover:text-slate-100"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {isUser && (
            <button
              aria-label="ویرایش پیام"
              title="ویرایش"
              onClick={() => p.onEditStart(msg)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#243352] bg-[#111a2e] text-slate-400 transition-colors hover:border-[#3b82f6] hover:text-slate-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {!isUser && p.isLastAssistant && !live && (
            <button
              aria-label="بازتولید پاسخ"
              title="بازتولید ↻"
              onClick={() => p.onRegenerate(msg.id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#243352] bg-[#111a2e] text-slate-400 transition-colors hover:border-[#3b82f6] hover:text-slate-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            aria-label="حذف پیام"
            title="حذف"
            onClick={() => p.onDelete(msg.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#243352] bg-[#111a2e] text-slate-400 transition-colors hover:border-red-500 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* آمار پاسخ */}
        {!isUser && (live || msg.timeSec != null) && (
          <span className="text-[11px] text-slate-500">
            {live && !msg.content ? (
              '⏳ در حال دریافت پاسخ…'
            ) : (
              <>
                {msg.timeSec != null && <>⏱ {msg.timeSec} ثانیه</>}
                {msg.chunks != null && <> · 🧩 {msg.chunks} تکه</>}
                {msg.chars != null && <> · ✍️ {msg.chars} نویسه</>}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
});

/* ---------- صفحه خوش‌آمد ---------- */
function WelcomeScreen({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-7 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#38bdf8] shadow-lg shadow-blue-500/20">
        <Sparkles className="h-8 w-8 text-white" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-extrabold text-slate-100">چت هوشمند</h2>
        <p className="text-sm text-slate-400">سوالی داری؟ بپرس — پاسخ را زنده و استریمی می‌گیری.</p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.text)}
            className="group flex items-start gap-3 rounded-2xl border border-[#243352] bg-[#111a2e] p-4 text-right transition-all hover:border-[#3b82f6] hover:bg-[#14203c]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0d1730] text-[#38bdf8] group-hover:bg-[#3b82f6] group-hover:text-white transition-colors">
              <s.icon className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-200">{s.title}</span>
              <span className="mt-1 block text-xs leading-6 text-slate-400 line-clamp-2">{s.text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- پنل Raw SSE (دیباگ) ---------- */
function RawPanel({
  preRef, onClear, onClose, byteCount,
}: {
  preRef: React.RefObject<HTMLPreElement | null>;
  onClear: () => void;
  onClose: () => void;
  byteCount: number;
}) {
  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-h-[300px] w-[min(92vw,460px)] flex-col overflow-hidden rounded-xl border border-[#243352] bg-[#0d1526] shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-[#243352] px-3 py-2">
        <span className="text-xs font-bold text-slate-300">📡 Raw SSE — دیتای خام استریم</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">{(byteCount / 1024).toFixed(1)}KB</span>
          <button
            aria-label="پاک کردن"
            onClick={onClear}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-[#1a2440] hover:text-slate-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="بستن"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-[#1a2440] hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <pre
        ref={preRef}
        dir="ltr"
        className="raw-pre m-0 flex-1 overflow-auto p-3 text-left font-mono text-[11px] leading-5 text-slate-300"
      />
    </div>
  );
}

/* ---------- کامپوننت اصلی ---------- */
export default function ChatApp() {
  /* ----- state ----- */
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveMsgId, setLiveMsgId] = useState<string | null>(null);
  const [status, setStatus] = useState<'ok' | 'checking' | 'fail'>('checking');
  const [rawOpen, setRawOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: 'ok' | 'err' }>>([]);
  const [rawBytes, setRawBytes] = useState(0);
  const [apiKeys, setApiKeys] = useState<{ openai: string; anthropic: string } | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false); // پیکر مدل باز است؟

  /* ----- refs ----- */
  const chatsRef = useRef<Chat[]>([]);
  const activeIdRef = useRef('');
  const settingsRef = useRef(settings);
  const streamingRef = useRef(false);
  const rawOpenRef = useRef(false);
  const settingsOpenRef = useRef(false);
  const modelPickerOpenRef = useRef(false); // پیکر مدل باز است؟ (برای Esc)
  const pickerRef = useRef<HTMLDivElement | null>(null); // پیکر مدل (برای تشخیص کلیک بیرون)
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<{ chatId: string; msgId: string; content: string; reasoning: string; chunks: number; error?: string; started: number } | null>(null);
  const rafRef = useRef(0);
  const rawRafRef = useRef(0);
  const rawLogRef = useRef('');
  const rawPreRef = useRef<HTMLPreElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  chatsRef.current = chats;
  activeIdRef.current = activeId;
  settingsRef.current = settings;
  streamingRef.current = streaming;
  rawOpenRef.current = rawOpen;
  settingsOpenRef.current = settingsOpen;
  modelPickerOpenRef.current = modelPickerOpen;

  /* ----- بستن پیکر مدل با کلیک بیرون از آن ----- */
  useEffect(() => {
    if (!modelPickerOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setModelPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [modelPickerOpen]);

  // بارگیری کلیدهای API هنگام باز شدن مودال تنظیمات (برای بخش API)
  useEffect(() => {
    if (!settingsOpen || apiKeys) return;
    fetch('/api/keys')
      .then((r) => r.json())
      .then((j) => setApiKeys({ openai: j.openai || '', anthropic: j.anthropic || '' }))
      .catch(() => {});
  }, [settingsOpen, apiKeys]);

  const activeChat = chats.find((c) => c.id === activeId) ?? chats[0];

  /* ----- toast ----- */
  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  /* ----- بارگذاری اولیه از localStorage (بعد از mount تا hydration نشکند) ----- */
  useEffect(() => {
    const loaded = loadChats();
    if (loaded.length) {
      setChats(loaded);
      setActiveId(loaded[0].id);
    } else {
      const c: Chat = { id: uid(), title: 'گفتگوی جدید', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      setChats([c]);
      setActiveId(c.id);
    }
    setSettings(loadSettings());
    // ping خودکار هنگام ورود
    fetch('/api/ping')
      .then((r) => r.json())
      .then((j: { status?: string; ms?: number }) => {
        if (j?.status === 'ok') setStatus('ok');
        else setStatus('fail');
      })
      .catch(() => setStatus('fail'));
  }, []);

  /* ----- ذخیره در localStorage (با debounce سبک) ----- */
  useEffect(() => {
    if (!chats.length) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem('fm_chats', JSON.stringify(chats));
      } catch {
        /* حافظه پر — نادیده بگیر */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [chats]);

  useEffect(() => {
    try {
      localStorage.setItem('fm_settings', JSON.stringify(settings));
    } catch {
      /* نادیده بگیر */
    }
  }, [settings]);

  /* ----- اسکرول خودکار ----- */
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom();
  }, [chats, scrollToBottom]);

  useEffect(() => {
    nearBottomRef.current = true;
    scrollToBottom();
  }, [activeId, scrollToBottom]);

  /* ----- flush تدریجی استریم با requestAnimationFrame (نه هر تکه یک بار) ----- */
  const flushNow = useCallback(() => {
    const st = streamRef.current;
    if (!st) return;
    setChats((prev) =>
      prev.map((c) =>
        c.id !== st.chatId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id !== st.msgId ? m : { ...m, content: st.content, reasoning: st.reasoning || undefined }
              ),
            }
      )
    );
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      flushNow();
    });
  }, [flushNow]);

  /* ----- پنل Raw SSE ----- */
  const appendRaw = useCallback((s: string) => {
    rawLogRef.current += s;
    if (rawLogRef.current.length > MAX_RAW_LOG) rawLogRef.current = rawLogRef.current.slice(-MAX_RAW_LOG);
    if (!rawOpenRef.current || rawRafRef.current) return;
    rawRafRef.current = requestAnimationFrame(() => {
      rawRafRef.current = 0;
      const el = rawPreRef.current;
      if (el) {
        el.textContent = rawLogRef.current;
        el.scrollTop = el.scrollHeight;
      }
      setRawBytes(rawLogRef.current.length);
    });
  }, []);

  const toggleRaw = useCallback(() => {
    setRawOpen((v) => {
      const nv = !v;
      if (nv) {
        requestAnimationFrame(() => {
          const el = rawPreRef.current;
          if (el) el.textContent = rawLogRef.current;
          setRawBytes(rawLogRef.current.length);
        });
      }
      return nv;
    });
  }, []);

  const clearRaw = useCallback(() => {
    rawLogRef.current = '';
    if (rawPreRef.current) rawPreRef.current.textContent = '';
    setRawBytes(0);
  }, []);

  /* ----- اتمام پیام استریمی ----- */
  const finishMsg = useCallback(
    (aborted: boolean, err?: unknown) => {
      const st = streamRef.current;
      if (!st) return;

      if (aborted && !st.content && !st.reasoning) {
        // هیچی نرسیده → حباب خالی را حذف کن
        setChats((prev) =>
          prev.map((c) => (c.id !== st.chatId ? c : { ...c, messages: c.messages.filter((m) => m.id !== st.msgId) }))
        );
        return;
      }

      const secs = Math.round((Date.now() - st.started) / 100) / 10;
      let content = st.content;
      let errorText: string | undefined;
      let isError = false;
      const stopped = aborted;

      if (!aborted) {
        if (st.error) {
          errorText = '❌ ' + st.error;
          isError = true;
        } else if ((err as { httpStatus?: number })?.httpStatus) {
          const he = err as { httpStatus: number; httpBody: string };
          errorText = `❌ HTTP ${he.httpStatus}${he.httpBody ? ' — ' + he.httpBody : ''}`;
          isError = true;
        } else if (err) {
          errorText =
            '❌ خطا در ارتباط با سرور — مطمئن شوید سرور در حال اجرا است و اتصال اینترنت برقرار است. (' +
            (err as Error).message +
            ')';
          isError = true;
        } else if (!content.trim() && !st.reasoning) {
          content = 'پاسخ خالی از سرور دریافت شد';
          isError = true;
        }
      }

      setChats((prev) =>
        prev.map((c) =>
          c.id !== st.chatId
            ? c
            : {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id !== st.msgId
                    ? m
                    : {
                        ...m,
                        content,
                        reasoning: st.reasoning || undefined,
                        errorText,
                        isError: isError || undefined,
                        stopped: stopped || undefined,
                        timeSec: secs,
                        chunks: st.chunks,
                        chars: content.length,
                      }
                ),
              }
        )
      );
    },
    []
  );

  /* ----- هسته اجرای پاسخ ----- */
  const runCompletion = useCallback(
    async (chatId: string, history: Msg[]) => {
      const s = settingsRef.current;
      const aid = uid();

      // پیام placeholder دستیار
      setChats((prev) =>
        prev.map((c) =>
          c.id !== chatId
            ? c
            : { ...c, updatedAt: Date.now(), messages: [...history, { id: aid, role: 'assistant' as Role, content: '', createdAt: Date.now() }] }
        )
      );
      setLiveMsgId(aid);
      setStreaming(true);
      streamRef.current = { chatId, msgId: aid, content: '', reasoning: '', chunks: 0, started: Date.now() };

      const ac = new AbortController();
      abortRef.current = ac;
      nearBottomRef.current = true;

      try {
        /* حافظه مکالمه: کل تاریخچه (فقط role و content) + system prompt اختیاری */
        const payloadMsgs: Array<{ role: string; content: string }> = [];
        const sp = (s.systemPrompt || '').trim();
        if (sp) payloadMsgs.push({ role: 'system', content: sp });
        for (const m of history) {
          if (m.isError || m.errorText) continue;
          payloadMsgs.push({ role: m.role, content: m.content });
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: payloadMsgs,
            modelId: s.modelId,
            thinking: s.thinking,
            deepSearch: s.deepSearch,
            stream: s.stream,
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          let errBody = '';
          try {
            errBody = (await res.text()).slice(0, 300);
          } catch {
            /* noop */
          }
          throw Object.assign(new Error('http'), { httpStatus: res.status, httpBody: errBody });
        }

        const parser = createSseParser({
          onEvent: (ev) => {
            const st = streamRef.current;
            if (!st) return;
            st.chunks++;
            if (ev.text) st.content += ev.text;
            if (ev.reasoning) st.reasoning += ev.reasoning;
            if (ev.error) st.error = ev.error;
            scheduleFlush();
          },
        });

        if (s.stream && res.body) {
          /* استریم زنده */
          const reader = res.body.getReader();
          const dec = new TextDecoder('utf-8');
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = dec.decode(value, { stream: true });
            appendRaw(chunk);
            parser.feed(chunk);
          }
          parser.end();
        } else {
          /* پاسخ JSON معمولی */
          const full = await res.text();
          appendRaw(full);
          parser.feed(full);
          parser.end();
        }
        flushNow();
        finishMsg(false);
      } catch (e) {
        flushNow();
        finishMsg(ac.signal.aborted || (e as Error).name === 'AbortError', e);
      } finally {
        streamRef.current = null;
        abortRef.current = null;
        setLiveMsgId(null);
        setStreaming(false);
      }
    },
    [appendRaw, finishMsg, flushNow, scheduleFlush]
  );

  /* ----- توقف استریم ----- */
  const stopStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ----- ارسال پیام ----- */
  const send = useCallback(
    (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || streamingRef.current) return;

      let chatId = activeIdRef.current;
      let base: Chat | undefined = chatsRef.current.find((c) => c.id === chatId);
      if (!base) {
        const c: Chat = { id: uid(), title: 'گفتگوی جدید', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        setChats((prev) => [c, ...prev]);
        setActiveId(c.id);
        chatId = c.id;
        base = c;
      }

      const isFirst = base.messages.length === 0;
      const userMsg: Msg = { id: uid(), role: 'user', content: text, createdAt: Date.now() };
      const history = [...base.messages, userMsg];

      setInput('');
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) el.style.height = 'auto';
      });

      setChats((prev) =>
        prev.map((c) =>
          c.id !== chatId ? c : { ...c, title: isFirst ? text.slice(0, 40) : c.title, messages: history, updatedAt: Date.now() }
        )
      );
      void runCompletion(chatId, history);
    },
    [input, runCompletion]
  );

  /* ----- گفتگوها ----- */
  const newChat = useCallback(() => {
    if (streamingRef.current) return;
    const c: Chat = { id: uid(), title: 'گفتگوی جدید', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      if (streamingRef.current && id === activeIdRef.current) return;
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (!next.length) {
          const c: Chat = { id: uid(), title: 'گفتگوی جدید', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
          setActiveId(c.id);
          return [c];
        }
        if (id === activeIdRef.current) setActiveId(next[0].id);
        return next;
      });
      toast('گفتگو حذف شد');
    },
    [toast]
  );

  const clearAllChats = useCallback(() => {
    if (!window.confirm('همه گفتگوها پاک شوند؟ این عمل قابل بازگشت نیست.')) return;
    const c: Chat = { id: uid(), title: 'گفتگوی جدید', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    setChats([c]);
    setActiveId(c.id);
    setSidebarOpen(false);
    toast('همه گفتگوها پاک شد');
  }, [toast]);

  const switchChat = useCallback((id: string) => {
    if (streamingRef.current) return;
    setActiveId(id);
    setEditingId(null);
    setSidebarOpen(false);
  }, []);

  /* ----- اکشن پیام‌ها ----- */
  const copyMsg = useCallback(
    async (m: Msg) => {
      const ok = await copyText(m.content);
      toast(ok ? 'پیام کپی شد ✓' : 'کپی ناموفق بود', ok ? 'ok' : 'err');
    },
    [toast]
  );

  const deleteMsg = useCallback((id: string) => {
    if (streamingRef.current) return;
    const cid = activeIdRef.current;
    setChats((prev) => prev.map((c) => (c.id !== cid ? c : { ...c, messages: c.messages.filter((m) => m.id !== id) })));
  }, []);

  const onEditStart = useCallback((m: Msg) => {
    setEditingId(m.id);
    setEditingText(m.content);
  }, []);

  const onEditCancel = useCallback(() => setEditingId(null), []);

  const onEditSave = useCallback(
    (id: string) => {
      const newText = editingText.trim();
      if (!newText || streamingRef.current) return;
      const chat = chatsRef.current.find((c) => c.id === activeIdRef.current);
      if (!chat) return;
      const idx = chat.messages.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const history = [...chat.messages.slice(0, idx), { ...chat.messages[idx], content: newText }];
      setEditingId(null);
      setChats((prev) => prev.map((c) => (c.id !== chat.id ? c : { ...c, messages: history, updatedAt: Date.now() })));
      toast('پیام ویرایش شد — پاسخ دوباره تولید می‌شود');
      void runCompletion(chat.id, history);
    },
    [editingText, runCompletion, toast]
  );

  const onRegenerate = useCallback(
    (id: string) => {
      if (streamingRef.current) return;
      const chat = chatsRef.current.find((c) => c.id === activeIdRef.current);
      if (!chat) return;
      const idx = chat.messages.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const history = chat.messages.slice(0, idx).filter((m) => !m.isError && !m.errorText);
      setChats((prev) => prev.map((c) => (c.id !== chat.id ? c : { ...c, messages: history, updatedAt: Date.now() })));
      void runCompletion(chat.id, history);
    },
    [runCompletion]
  );

  /* ----- ping دستی ----- */
  const runPing = useCallback(async () => {
    setStatus('checking');
    try {
      const r = await fetch('/api/ping');
      const j = (await r.json()) as { status?: string; ms?: number; sample?: string };
      if (j?.status === 'ok') {
        setStatus('ok');
        toast(`اتصال برقرار است · ${j.ms ?? '?'} ms`);
      } else {
        setStatus('fail');
        toast('اتصال به سرویس برقرار نیست', 'err');
      }
    } catch {
      setStatus('fail');
      toast('خطا در بررسی اتصال', 'err');
    }
  }, [toast]);

  /* ----- خروجی‌ها ----- */
  const exportMarkdown = useCallback(() => {
    const chat = chatsRef.current.find((c) => c.id === activeIdRef.current);
    if (!chat || !chat.messages.length) {
      toast('این گفتگو خالی است', 'err');
      return;
    }
    const s = settingsRef.current;
    const lines: string[] = [`# ${chat.title}`, '', `- مدل: \`${s.modelId}\``, `- تاریخ خروجی: ${fmtTime(Date.now())}`, '', '---', ''];
    for (const m of chat.messages) {
      lines.push(m.role === 'user' ? '## 👤 کاربر' : '## 🤖 دستیار');
      lines.push('');
      lines.push(m.content || (m.errorText ?? ''));
      if (!m.role.includes('x') && m.timeSec != null) {
        lines.push('');
        lines.push(`> ⏱ ${m.timeSec} ثانیه · 🧩 ${m.chunks} تکه · ✍️ ${m.chars} نویسه${m.stopped ? ' · ⏹ متوقف شد' : ''}`);
      }
      lines.push('');
    }
    const name = (chat.title || 'chat').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40);
    downloadFile(`${name}.md`, lines.join('\n'), 'text/markdown');
    toast('فایل Markdown دانلود شد ✓');
  }, [toast]);

  const exportJson = useCallback(() => {
    const all = chatsRef.current;
    if (!all.length) {
      toast('گفتگویی برای خروجی نیست', 'err');
      return;
    }
    const payload = { exportedAt: new Date().toISOString(), chats: all };
    downloadFile('fm-chats-backup.json', JSON.stringify(payload, null, 2), 'application/json');
    toast('فایل JSON دانلود شد ✓');
  }, [toast]);

  /* ----- کپی بلوک کد (delegation) ----- */
  const onChatAreaClick = useCallback(
    async (e: React.MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('button[data-code-id]');
      if (!btn) return;
      const code = getCodeById(btn.getAttribute('data-code-id') || '');
      if (code != null) {
        const ok = await copyText(code);
        if (ok) {
          btn.textContent = 'کپی شد ✓';
          setTimeout(() => {
            btn.textContent = 'کپی';
          }, 1500);
        } else {
          toast('کپی ناموفق بود', 'err');
        }
      }
    },
    [toast]
  );

  /* ----- میان‌بر Esc: توقف استریم / بستن پنل‌ها ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (streamingRef.current) {
        stopStream();
      } else if (modelPickerOpenRef.current) {
        setModelPickerOpen(false);
      } else if (settingsOpenRef.current) {
        setSettingsOpen(false);
      } else if (rawOpenRef.current) {
        setRawOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stopStream]);

  /* ----- قطع درخواست هنگام بستن صفحه ----- */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* ----- auto-resize textarea ----- */
  const autoResize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  const onTaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  /* ----- وضعیت اتصال ----- */
  const statusMeta = {
    ok: { dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.8)]', text: 'متصل' },
    checking: { dot: 'bg-amber-400 animate-pulse', text: 'در حال بررسی…' },
    fail: { dot: 'bg-red-500', text: 'بدون اتصال' },
  }[status];

  const messages = activeChat?.messages ?? [];

  /* ----- مدل فعلی برای دکمهٔ پیکر (اگر id دستی ذخیره شده باشد، همان خام نشان داده می‌شود) ----- */
  const currentModel = MODELS.find((m) => m.id === settings.modelId);

  /* ================= رندر ================= */
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0b1220] text-slate-200">
      {/* ---------- هدر ---------- */}
      <header className="z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-[#243352] bg-[#0d1526]/95 px-3 py-2 backdrop-blur sm:px-4">
        <button
          aria-label="باز کردن منوی گفتگوها"
          onClick={() => setSidebarOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#243352] text-slate-300 hover:bg-[#1a2440] md:hidden"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <div className="hidden items-center gap-2 lg:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#38bdf8]">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <span className="text-sm font-extrabold text-slate-100">چت هوشمند</span>
        </div>

        {/* مدل — پیکر گروهی مثل سایت freemodels */}
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={modelPickerOpen}
            aria-label="انتخاب مدل"
            onClick={() => setModelPickerOpen((o) => !o)}
            className="flex h-9 min-w-[150px] max-w-[220px] items-center gap-2 rounded-lg border border-[#243352] bg-[#111a2e] px-2.5 transition-colors hover:border-[#3b82f6]"
          >
            {currentModel && (
              <img
                src={currentModel.logo}
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 shrink-0 rounded-md border border-[#0A0A0B]/10 bg-white object-contain p-0.5"
              />
            )}
            <span dir="ltr" className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-100">
              {currentModel ? currentModel.name : settings.modelId}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {modelPickerOpen && (
            <div
              role="listbox"
              aria-label="مدل‌ها"
              dir="ltr"
              className="absolute right-0 top-full z-50 mt-2 max-h-[min(55dvh,320px)] w-[264px] overscroll-contain overflow-auto rounded-xl border border-black/10 bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.35)]"
            >
              {MODEL_GROUPS.map((g) => (
                <div key={g.title} className="mb-1.5 last:mb-0">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#0A0A0B]/60">
                    <g.icon className="h-3 w-3" aria-hidden="true" />
                    {g.title}
                  </div>
                  <div className="space-y-0.5">
                    {MODELS.filter((m) => m.group === g.title).map((m) => {
                      const sel = m.id === settings.modelId;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={sel}
                          onClick={() => {
                            setSettings((s) => ({ ...s, modelId: m.id }));
                            setModelPickerOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors min-h-[44px] sm:min-h-0 sm:py-2 ${
                            sel ? 'bg-[#0A0A0B] text-white' : 'text-[#0A0A0B] hover:bg-[#FFFBF5] active:bg-[#F5F3EF]'
                          }`}
                        >
                          <img
                            alt={m.name}
                            width={20}
                            height={20}
                            src={m.logo}
                            className="h-5 w-5 shrink-0 rounded-md border border-[#0A0A0B]/10 bg-white object-contain p-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate text-xs font-medium leading-none ${sel ? 'text-white' : 'text-[#0A0A0B]'}`}
                            >
                              {m.name}
                            </span>
                            <span
                              className={`mt-0.5 block truncate text-[11px] leading-none ${sel ? 'text-white/60' : 'text-[#0A0A0B]/60'}`}
                            >
                              {m.vendor}
                            </span>
                          </span>
                          {sel && <Check className="h-3.5 w-3.5 shrink-0 text-white" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* گزینه‌ها */}
        <div className="hidden items-center gap-3 rounded-lg border border-[#243352] bg-[#111a2e] px-3 py-1.5 sm:flex">
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={settings.thinking}
              onChange={(e) => setSettings((s) => ({ ...s, thinking: e.target.checked }))}
              className="h-3.5 w-3.5 accent-[#3b82f6]"
            />
            تفکر
          </label>
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={settings.deepSearch}
              onChange={(e) => setSettings((s) => ({ ...s, deepSearch: e.target.checked }))}
              className="h-3.5 w-3.5 accent-[#3b82f6]"
            />
            جستجوی عمیق
          </label>
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={settings.stream}
              onChange={(e) => setSettings((s) => ({ ...s, stream: e.target.checked }))}
              className="h-3.5 w-3.5 accent-[#3b82f6]"
            />
            استریم
          </label>
        </div>

        <div className="flex-1" />

        {/* اتصال */}
        <button
          onClick={runPing}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#243352] px-2.5 text-xs text-slate-300 transition-colors hover:border-[#3b82f6] hover:bg-[#1a2440]"
          title="تست اتصال به سرویس"
        >
          <Activity className="h-3.5 w-3.5" />
          اتصال؟
        </button>

        {/* Raw SSE */}
        <button
          onClick={toggleRaw}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
            rawOpen
              ? 'border-[#3b82f6] bg-[#14203c] text-[#38bdf8]'
              : 'border-[#243352] text-slate-300 hover:border-[#3b82f6] hover:bg-[#1a2440]'
          }`}
          title="پنل دیتای خام استریم"
        >
          <Code2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Raw SSE</span>
        </button>

        {/* تنظیمات */}
        <button
          aria-label="تنظیمات"
          onClick={() => {
            setDraftPrompt(settings.systemPrompt);
            setSettingsOpen(true);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#243352] text-slate-300 transition-colors hover:border-[#3b82f6] hover:bg-[#1a2440]"
          title="تنظیمات"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* نشانگر وضعیت */}
        <div className="flex items-center gap-1.5 rounded-lg border border-[#243352] bg-[#111a2e] px-2.5 py-1.5" title={statusMeta.text}>
          <span className={`h-2 w-2 rounded-full ${statusMeta.dot}`} />
          <span className="hidden text-xs text-slate-400 sm:inline">{statusMeta.text}</span>
        </div>
      </header>

      {/* ---------- بدنه ---------- */}
      <div className="flex min-h-0 flex-1">
        {/* پوشش موبایل سایدبار */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* ---------- سایدبار راست ---------- */}
        <aside
          className={`fixed inset-y-0 right-0 z-50 flex w-[260px] flex-col border-l border-[#243352] bg-[#0d1526] transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#243352] p-3">
            <span className="flex items-center gap-2 text-sm font-extrabold text-slate-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#38bdf8]">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </span>
              گفتگوها
            </span>
            <button
              aria-label="بستن"
              onClick={() => setSidebarOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#1a2440] md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-3">
            <button
              onClick={newChat}
              disabled={streaming}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3b82f6] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> چت جدید
            </button>
          </div>

          <nav aria-label="لیست گفتگوها" className="chat-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
            {chats.map((c) => {
              const isActive = c.id === activeChat?.id;
              return (
                <div
                  key={c.id}
                  onClick={() => switchChat(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && switchChat(c.id)}
                  className={`group/item flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'border-[#3b82f6]/60 bg-[#14203c] text-slate-100'
                      : 'border-transparent bg-transparent text-slate-400 hover:bg-[#111a2e] hover:text-slate-200'
                  }`}
                >
                  <MessageSquare className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#38bdf8]' : 'opacity-50'}`} />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <button
                    aria-label={`حذف گفتگوی ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(c.id);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover/item:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </nav>

          {/* خروجی‌ها */}
          <div className="space-y-2 border-t border-[#243352] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={exportMarkdown}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-[#243352] py-2 text-xs text-slate-300 transition-colors hover:border-[#3b82f6] hover:bg-[#1a2440]"
                title="خروجی Markdown از گفتگوی فعلی"
              >
                <Download className="h-3.5 w-3.5" /> Markdown
              </button>
              <button
                onClick={exportJson}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-[#243352] py-2 text-xs text-slate-300 transition-colors hover:border-[#3b82f6] hover:bg-[#1a2440]"
                title="خروجی JSON از همه گفتگوها"
              >
                <FileJson className="h-3.5 w-3.5" /> JSON
              </button>
            </div>
            <button
              onClick={clearAllChats}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/30 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> پاک کردن همه
            </button>
          </div>
        </aside>

        {/* ---------- ناحیه اصلی چت ---------- */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            onClick={onChatAreaClick}
            role="log"
            aria-live="polite"
            aria-label="گفتگو"
            className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
          >
            <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5">
              {messages.length === 0 && !streaming ? (
                <WelcomeScreen onPick={(t) => send(t)} />
              ) : (
                messages.map((m, i) => (
                  <MessageItem
                    key={m.id}
                    msg={m}
                    live={m.id === liveMsgId}
                    isLastAssistant={m.role === 'assistant' && i === messages.length - 1}
                    editing={editingId === m.id}
                    editingText={editingText}
                    onEditingTextChange={setEditingText}
                    onCopy={copyMsg}
                    onEditStart={onEditStart}
                    onEditSave={onEditSave}
                    onEditCancel={onEditCancel}
                    onDelete={deleteMsg}
                    onRegenerate={onRegenerate}
                  />
                ))
              )}
            </div>
          </div>

          {/* ---------- کامپوزر پایین ---------- */}
          <div className="shrink-0 border-t border-[#243352] bg-[#0d1526] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <textarea
                ref={taRef}
                dir="auto"
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={onTaKeyDown}
                placeholder="پیام خود را بنویسید… (Enter ارسال · Shift+Enter خط جدید)"
                aria-label="متن پیام"
                className="chat-scroll max-h-[200px] min-h-[46px] flex-1 resize-none rounded-2xl border border-[#243352] bg-[#111a2e] px-4 py-3 text-[15px] leading-7 text-slate-100 placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
              />
              {streaming ? (
                <button
                  onClick={stopStream}
                  className="flex h-[46px] shrink-0 items-center gap-2 rounded-2xl bg-red-500/90 px-4 text-sm font-bold text-white transition-colors hover:bg-red-500"
                  title="توقف پاسخ (Esc)"
                >
                  <Square className="h-4 w-4 fill-current" />
                  توقف
                </button>
              ) : (
                <button
                  onClick={() => send()}
                  disabled={!input.trim()}
                  aria-label="ارسال پیام"
                  className="flex h-[46px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-[#3b82f6] text-white transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-[18px] w-[18px] -scale-x-100" />
                </button>
              )}
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-slate-500">
              پاسخ‌ها زنده استریم می‌شوند · Esc برای توقف — پاسخ‌های هوش مصنوعی ممکن است نادرست باشند.
            </p>
          </div>
        </main>
      </div>

      {/* پنل Raw SSE */}
      {rawOpen && <RawPanel preRef={rawPreRef} onClear={clearRaw} onClose={() => setRawOpen(false)} byteCount={rawBytes} />}

      {/* مودال تنظیمات */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تنظیمات"
            className="relative w-full max-w-lg space-y-4 rounded-2xl border border-[#243352] bg-[#111a2e] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-100">
                <Settings className="h-4.5 w-4.5 text-[#38bdf8]" /> تنظیمات
              </h3>
              <button
                aria-label="بستن"
                onClick={() => setSettingsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#1a2440] hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="sys-prompt" className="block text-sm font-bold text-slate-300">
                System Prompt (اختیاری)
              </label>
              <textarea
                id="sys-prompt"
                dir="auto"
                rows={5}
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                placeholder="مثلاً: همیشه به فارسی و خلاصه پاسخ بده…"
                className="chat-scroll w-full resize-none rounded-xl border border-[#243352] bg-[#0d1730] px-3 py-2.5 text-sm leading-7 text-slate-100 placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
              />
              <p className="text-[11px] leading-6 text-slate-500">
                این متن در هر درخواست به‌صورت اولین پیام <code className="md-icode">{'{role:"system"}'}</code> به مدل ارسال
                می‌شود. گفتگوها و تنظیمات به‌صورت محلی در مرورگر شما ذخیره می‌شوند.
              </p>
            </div>

            {/* بخش API سازگار OpenAI و Anthropic */}
            <div className="space-y-2 border-t border-dashed border-[#243352] pt-4">
              <h4 className="flex items-center gap-1.5 text-sm font-extrabold text-[#38bdf8]">🔑 اندپوینت‌های API و کلیدها</h4>
              <p className="text-[11px] leading-6 text-slate-500">
                این سرور هم‌زمان API سازگار با OpenAI و Anthropic ارائه می‌دهد؛ کلیدها در فایل api-keys.json ذخیره شده‌اند.
              </p>
              {(['openai', 'anthropic'] as const).map((kind) => (
                <div
                  key={kind}
                  className="flex items-center gap-2 rounded-xl border border-[#243352] bg-[#0d1730] px-3 py-2"
                >
                  <span className="w-16 shrink-0 text-[10.5px] font-bold text-slate-400">
                    {kind === 'openai' ? 'OpenAI' : 'Anthropic'}
                  </span>
                  <code
                      dir="ltr"
                      className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-[10.5px] text-sky-300"
                  >
                    {apiKeys ? apiKeys[kind] : '…'}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!apiKeys) return;
                      const ok = await copyText(apiKeys[kind]);
                      toast(ok ? 'کلید کپی شد ✓' : 'کپی ناموفق بود', ok ? 'ok' : 'err');
                    }}
                    className="shrink-0 rounded-lg border border-[#243352] px-2.5 py-1 text-[11px] text-slate-300 hover:border-[#38bdf8] hover:text-[#38bdf8]"
                  >
                    کپی
                  </button>
                </div>
              ))}
              <div
                dir="ltr"
                className="rounded-xl border border-[#243352] bg-[#0d1730] px-3 py-2 text-left font-mono text-[10.5px] leading-6 text-slate-400"
              >
                <div>POST {typeof window !== 'undefined' ? window.location.origin : ''}/v1/chat/completions (OpenAI-compatible)</div>
                <div>POST {typeof window !== 'undefined' ? window.location.origin : ''}/v1/messages (Anthropic-compatible)</div>
                <div>GET&nbsp;&nbsp;{typeof window !== 'undefined' ? window.location.origin : ''}/v1/models</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg border border-[#243352] px-4 py-2 text-sm text-slate-300 hover:bg-[#1a2440]"
              >
                انصراف
              </button>
              <button
                onClick={() => {
                  setSettings((s) => ({ ...s, systemPrompt: draftPrompt.trim() }));
                  setSettingsOpen(false);
                  toast('تنظیمات ذخیره شد ✓');
                }}
                className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-bold text-white hover:bg-[#2563eb]"
              >
                ذخیره
              </button>
            </div>
          </div>
        </div>
      )}

      {/* توست‌ها */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-4 py-2 text-sm shadow-xl backdrop-blur ${
              t.kind === 'err'
                ? 'border-red-500/50 bg-[#2a1220]/95 text-red-200'
                : 'border-emerald-500/40 bg-[#0f2018]/95 text-emerald-200'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
