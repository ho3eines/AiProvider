#!/usr/bin/env python3
"""جایگزاری placeholder ایکه EMBEDDED_LOGOS در app.js با base64 واقعی لوگوها"""
import base64
import json
import os

APP = '/home/z/my-project/app.js'
TMP = '/tmp'

LOGOS = [
    ('/Claude-ai-logo.webp', os.path.join(TMP, 'claude96.webp'), 'image/webp'),
    ('/ChatGPT-Logo.svg.webp', os.path.join(TMP, 'chatgpt96.webp'), 'image/webp'),
    ('/zai.png', os.path.join(TMP, 'zai96.png'), 'image/png'),
    ('/kimi-logo-png_seeklogo-611650.png', os.path.join(TMP, 'kimi96.png'), 'image/png'),
]

out = {}
for route, path, mime in LOGOS:
    with open(path, 'rb') as f:
        out[route] = {'mime': mime, 'b64': base64.b64encode(f.read()).decode('ascii')}

payload = json.dumps(out, separators=(',', ':'))

with open(APP, 'r', encoding='utf-8') as f:
    src = f.read()

marker = '__EMBEDDED_LOGOS_JSON__'
assert marker in src, 'placeholder not found!'
src = src.replace(marker, payload, 1)

with open(APP, 'w', encoding='utf-8') as f:
    f.write(src)

print('embedded logos OK —', len(payload), 'bytes of JSON injected')
