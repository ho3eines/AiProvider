/**
 * پارسر جهانی SSE / استریم چت
 * از همه فرمت‌های رایج پشتیبانی می‌کند:
 *  - data: {"choices":[{"delta":{"content":"..."}}]}        (سبک OpenAI)
 *  - data: {"content":"..."} یا {"text":"..."}               (فیلد مستقیم)
 *  - {"content":"..."} بدون پیشوند data:                     (آبجکت خام)
 *  - رشتهٔ خام غیر JSON                                       (مستقیم به متن اضافه می‌شود)
 *  - data: [DONE]                                            (پایان استریم)
 * فیلدهای تفکر: reasoning_content / reasoning / thinking / delta.thinking
 * هر خط جدا پردازش می‌شود؛ JSON ناقص در بافر نگه داشته می‌شود تا با خط بعدی کامل شود.
 */

export interface SseEvent {
  text: string;
  reasoning: string;
  error?: string;
}

export interface SseParser {
  feed(chunk: string): void;
  end(): void;
}

export interface EmitOptions {
  onEvent: (ev: SseEvent) => void;
  /**
   * نام فیلدهای متنیِ اضافیِ مخصوص یک آپستریم (از providers.json → response.textFields).
   * روی ریشهٔ آبجکت، `delta`، `message` و `choices[0].delta/message` جست‌وجو می‌شوند.
   */
  extraTextFields?: string[];
  /** نام فیلدهای «تفکر» اضافی (از response.reasoningFields) */
  extraReasoningFields?: string[];
  /** نشانهٔ پایان استریم — پیش‌فرض `[DONE]` */
  doneToken?: string;
}

export function createSseParser(opts: EmitOptions): SseParser {
  let buf = ''; // بافر خطوط ناقص
  let pendingJson = ''; // JSON چندخطیِ ناقص
  const extraText = (opts.extraTextFields || []).filter((f) => typeof f === 'string' && f);
  const extraReason = (opts.extraReasoningFields || []).filter((f) => typeof f === 'string' && f);
  const doneToken = opts.doneToken || '[DONE]';

  const emit = (text = '', reasoning = '', error?: string) => {
    if (text || reasoning || error) opts.onEvent({ text, reasoning, error });
  };

  /** استخراج متن/تفکر/خطا از هر شکلی از آبجکت پاسخ */
  const addText = (v: unknown, out: { text: string; reasoning: string }) => {
    if (typeof v === 'string') out.text += v;
    else if (Array.isArray(v)) {
      for (const b of v) {
        if (typeof b === 'string') out.text += b;
        else if (b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string') {
          out.text += (b as Record<string, unknown>).text;
        }
      }
    }
  };
  const addReason = (v: unknown, out: { text: string; reasoning: string }) => {
    if (typeof v === 'string') out.reasoning += v;
  };

  function applyObject(obj: unknown): void {
    const out = { text: '', reasoning: '' };
    let error: string | undefined;
    const o = obj as Record<string, any> | null;
    if (!o || typeof o !== 'object') {
      emit(String(obj));
      return;
    }

    // --- سبک OpenAI: choices[0].delta / choices[0].message ---
    const choice = Array.isArray(o.choices) ? o.choices[0] : undefined;
    if (choice && typeof choice === 'object') {
      const delta = (choice as Record<string, any>).delta;
      const message = (choice as Record<string, any>).message;
      if (delta && typeof delta === 'object') {
        addText(delta.content, out);
        addText(delta.text, out);
        addReason(delta.reasoning_content, out);
        addReason(delta.reasoning, out);
        addReason(delta.thinking, out);
      }
      if (message && typeof message === 'object') {
        addText(message.content, out);
        addText(message.text, out);
        addReason(message.reasoning_content, out);
        addReason(message.reasoning, out);
        addReason(message.thinking, out);
      }
      if (typeof (choice as Record<string, unknown>).text === 'string') {
        addText((choice as Record<string, unknown>).text, out);
      }
    }

    // --- سبک Claude: type=content_block_delta با delta.text / delta.thinking ---
    const topDelta = o.delta;
    if (topDelta && typeof topDelta === 'object') {
      addText(topDelta.text, out);
      addText(topDelta.content, out);
      addReason(topDelta.thinking, out);
      addReason(topDelta.reasoning_content, out);
      addReason(topDelta.reasoning, out);
    }
    const topMessage = o.message;
    if (topMessage && typeof topMessage === 'object') {
      addText(topMessage.content, out);
      addReason(topMessage.reasoning_content, out);
      addReason(topMessage.thinking, out);
    }

    // --- فیلدهای مستقیم روی ریشه ---
    addText(o.content, out);
    addText(o.text, out);
    addReason(o.reasoning_content, out);
    addReason(o.reasoning, out);
    addReason(o.thinking, out);

    // --- فیلدهای سفارشیِ همان پروایدر (providers.json → response.textFields/reasoningFields) ---
    if (extraText.length || extraReason.length) {
      const scopes: Array<Record<string, any>> = [o];
      if (topDelta && typeof topDelta === 'object') scopes.push(topDelta as Record<string, any>);
      if (topMessage && typeof topMessage === 'object') scopes.push(topMessage as Record<string, any>);
      if (choice && typeof choice === 'object') {
        scopes.push(choice as Record<string, any>);
        const cd = (choice as Record<string, any>).delta;
        const cm = (choice as Record<string, any>).message;
        if (cd && typeof cd === 'object') scopes.push(cd);
        if (cm && typeof cm === 'object') scopes.push(cm);
      }
      for (const s of scopes) {
        for (const f of extraText) addText(s?.[f], out);
        for (const f of extraReason) addReason(s?.[f], out);
      }
    }

    // --- خطای داخل استریم ---
    if (o.error) {
      error =
        typeof o.error === 'string'
          ? o.error
          : typeof o.error?.message === 'string'
            ? o.error.message
            : JSON.stringify(o.error);
    }

    emit(out.text, out.reasoning, error);
  }

  /** پردازش یک payload کامل (بعد از حذف data: یا به‌صورت خط خام) */
  function handlePayload(payload: string): void {
    const t = payload.trim();
    if (!t) return;
    if (t === doneToken || t === '[DONE]') return; // پایان استریم
    if (t.startsWith('{') || t.startsWith('[')) {
      // JSON ممکن است چندخطی باشد؛ تا کامل شدن نگه می‌داریم
      pendingJson = pendingJson ? pendingJson + '\n' + payload : payload;
      try {
        applyObject(JSON.parse(pendingJson));
        pendingJson = '';
      } catch {
        /* هنوز ناقص است؛ خط بعدی ادامه می‌دهد */
      }
    } else {
      // رشتهٔ خام غیر JSON → مستقیم به متن
      flushPending();
      emit(payload);
    }
  }

  function flushPending(): void {
    if (!pendingJson) return;
    emit(pendingJson); // JSON ناتمام → به‌صورت خام
    pendingJson = '';
  }

  function processLine(line: string): void {
    if (line === '') {
      flushPending();
      return;
    }
    if (line.startsWith(':')) return; // کامنت SSE مثل ": ping"
    if (line.startsWith('data:')) {
      let p = line.slice(5);
      if (p.startsWith(' ')) p = p.slice(1);
      handlePayload(p);
      return;
    }
    if (/^(event|id|retry)\s*:/i.test(line)) return; // متادیتای SSE
    handlePayload(line); // خط خام (مثلاً {"content":"..."} بدون data:)
  }

  return {
    feed(chunk: string): void {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        processLine(line);
      }
    },
    end(): void {
      if (buf.trim()) {
        processLine(buf.replace(/\r$/, ''));
        buf = '';
      }
      // JSON ناتمام باقی‌مانده را خام منتشر کن
      if (pendingJson) {
        emit(pendingJson);
        pendingJson = '';
      }
    },
  };
}
