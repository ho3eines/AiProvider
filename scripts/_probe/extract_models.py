#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""استخراج آرایهٔ کامل مدل‌ها از باندل واقعی freemodels.pro"""
import re
import json

src = open('/home/z/my-project/scripts/_probe/bundle.js', encoding='utf-8', errors='replace').read()

i = src.find('Tl=[{id:"claude-sonnet-5"')
if i < 0:
    i = src.find('claude-sonnet-5",name:"Claude Sonnet 5"')
    i = src.rfind('[{id:', 0, i + 2)
chunk = src[i:i + 6000]

# هر آبجکت مدل تا قبل از {id: بعدی یا پایان آرایه ]
parts = re.split(r'(?=\{id:"(?:claude-|sol|terra|glm-|kimi-))', chunk)
models = []
for p in parts[1:]:
    end = p.find('"}') 
    # دقیق‌تر: تا آخرین "}] یا },{ — برش تا رسیدن به {id بعدی خودِ split انجام شده؛ فقط انتهای آبجکت را پیدا کن
    # آبجکت با } بسته می‌شود قبل از شروع بعدی؛ ولی فیلدهای تودرتو (tags آرایه) داریم — تا "} ,{" یا "}]"
    m = re.match(r'\{.*?"(?:\])?"?\s*(?=\[?\{?"?(?:\{|$))', p)
    # ساده‌تر: از ابتدای p تا اولین '"},{' یا '"}]' یا '}]'
    ends = [p.find('"},{'), p.find('"}]'), p.find('}],'), p.find('}]')]
    ends = [e for e in ends if e > 0]
    if ends:
        obj_str = p[:min(ends) + 2]
    else:
        obj_str = p[:800]
    models.append(obj_str)

for m in models:
    print(m)
    print('---')
