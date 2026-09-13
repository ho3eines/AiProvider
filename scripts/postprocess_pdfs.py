#!/usr/bin/env python3
"""Post-process Smart Chat PDFs: page numbers (cover hidden, body starts at 1),
metadata, and U+FFFD text scan. Per pdf skill pagination.md + content rules."""
import pymupdf

DOCS = [
    ("/home/z/my-project/download/docs/SmartChat-README.pdf",
     "چت هوشمند — Project Documentation | مستندات کامل پروژه",
     "Complete bilingual project documentation: architecture, requirements, install & run, features, API reference, models, history, roadmap"),
    ("/home/z/my-project/download/docs/SmartChat-HANDOFF.pdf",
     "چت هوشمند — Project Handoff | سند تحویل پروژه",
     "Developer onboarding brief: quick start, critical gotchas, contract, verification checklist, task history, next steps"),
]

GRAY = (0x5A / 255, 0x7A / 255, 0x96 / 255)  # --c-muted, same blue family

for path, title, subject in DOCS:
    doc = pymupdf.open(path)
    # 1) stamp page numbers: skip cover (page 0); body page k shows number k
    for i in range(1, doc.page_count):
        page = doc[i]
        num = str(i)  # page 2 (i=1) -> "1"
        w = page.rect.width
        page.insert_text(
            pymupdf.Point(w / 2 - 4 * len(num), page.rect.height - 28),
            num, fontsize=9, fontname="helv", color=GRAY,
        )
    # 2) metadata
    doc.set_metadata({
        "title": title,
        "author": "Z.ai",
        "creator": "Z.ai",
        "subject": subject,
        "producer": "Z.ai PDF Workbench",
    })
    doc.saveIncr()
    doc.close()

    # 3) text sanity scan
    doc = pymupdf.open(path)
    bad = 0
    empty_pages = []
    for i, page in enumerate(doc):
        txt = page.get_text()
        bad += txt.count("\ufffd")
        if i > 0 and len(txt.strip()) < 20:
            empty_pages.append(i + 1)
    print(f"{path.split('/')[-1]}: pages={doc.page_count} fffd={bad} near_empty_pages={empty_pages or 'none'}")
    doc.close()
print("done")
