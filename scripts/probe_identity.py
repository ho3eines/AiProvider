#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
پروب هویت مدل‌های آپستریم freemodels
می‌پرسیم هر modelId خودش را چه مدلی معرفی می‌کند + فیلد model داخل پاسخ خام را چاپ می‌کنیم.
"""
import json
import sys
import time
import urllib.request
import urllib.error

UPSTREAM = 'https://freemodels-chat.freemodels.workers.dev/'
HEADERS = {
    'Content-Type': 'application/json',
    'Origin': 'https://freemodels.pro',
    'Referer': 'https://freemodels.pro/',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'Accept-Encoding': 'identity',
}

Q = 'What exact model are you? Answer in one short English sentence, no markdown.'

MODELS = [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'claude-sonnet-5',   # کنترل
    'glm-5.2',           # کنترل
]


def ask(model: str, retries: int = 3):
    body = json.dumps({
        'messages': [{'role': 'user', 'content': Q}],
        'modelId': model,
        'thinking': False,
        'deepSearch': False,
        'stream': False,
    }).encode('utf-8')

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(UPSTREAM, data=body, headers=HEADERS, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read().decode('utf-8', errors='replace')
                return r.status, raw
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', errors='replace')
            if e.code == 429 and attempt < retries:
                print(f'   [{model}] 429 — retry {attempt}/{retries - 1} بعد از ۲۵ ثانیه...')
                time.sleep(25)
                continue
            return e.code, raw
        except Exception as e:
            if attempt < retries:
                time.sleep(4)
                continue
            return -1, f'{type(e).__name__}: {e}'
    return -1, ''


def summarize(model: str):
    status, raw = ask(model)
    print(f'\n=== {model} === HTTP {status}')
    # فیلدهای model احتمالی داخل پاسخ خام
    try:
        j = json.loads(raw)
        for key in ('model', 'modelId', 'model_id', 'actualModel'):
            if isinstance(j, dict) and key in j:
                print(f'   فیلد "{key}": {j[key]}')
        # در برخی پاسخ‌ها choices[0].model یا message.model
        if isinstance(j, dict) and isinstance(j.get('choices'), list) and j['choices']:
            ch = j['choices'][0]
            if isinstance(ch, dict) and 'model' in ch:
                print(f'   choices[0].model: {ch["model"]}')
    except Exception:
        pass
    text = raw.replace('\n', ' ')
    print(f'   خام (۴۰۰ نویسهٔ اول): {text[:400]}')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        MODELS = sys.argv[1:]
    for m in MODELS:
        summarize(m)
        time.sleep(2)
