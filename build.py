#!/usr/bin/env python3
"""Builds the site into ./dist from templates/ and content/.

No installs needed: this uses only Python's standard library.
Run:  python3 build.py
"""
import glob
import html
import json
import time
import os
import re
import shutil
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")

COVERS = {
    "1": ("#FFF3C4", '<span style="position: absolute; left: -30px; bottom: -60px; width: 200px; height: 200px; border-radius: 50%; background: #FFCE00"></span><span style="position: absolute; right: 28px; top: 28px; width: 72px; height: 72px; border-radius: 22px; background: #2D2A3E; transform: rotate(14deg)"></span>'),
    "2": ("#FFD9C7", '<span style="position: absolute; right: -40px; top: -40px; width: 190px; height: 190px; border-radius: 50%; background: #FF7A50"></span><span style="position: absolute; left: 28px; bottom: 28px; width: 120px; height: 44px; border-radius: 22px; background: #FFFFFF"></span>'),
    "3": ("#D5F0DF", '<span style="position: absolute; left: 36px; top: 36px; width: 96px; height: 96px; border-radius: 50%; background: #2D2A3E"></span><span style="position: absolute; right: -20px; bottom: -50px; width: 180px; height: 180px; border-radius: 48px; background: #5B2FC4; transform: rotate(20deg)"></span>'),
}
ROTS = [-5, 4, -3, 6, -4, 3, 5, -6, 2, -2]
PINS = ["#FF7A50", "#5B2FC4", "#FFCE00", "#2D2A3E"]
EQ = ["eq", "eq eq2", "eq eq3", "eq eq4"]
ROW_COLOURS = ["#FFCE00", "#FF7A50", "#BFE8D4"]


def esc(text):
    return html.escape(str(text or ""), quote=True)


def read_abs(path):
    return open(path, encoding="utf-8").read()


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def write(path, text):
    full = os.path.join(DIST, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)


def nice_date(value):
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").strftime("%-d %B %Y")
    except ValueError:
        return str(value)


def fill(template, data, root):
    """Replace [[section.key]] with values from site.json, and [[ROOT]]."""
    def lookup(match):
        section, key = match.group(1), match.group(2)
        return esc(data.get(section, {}).get(key, ""))
    out = re.sub(r"\[\[([a-z]+)\.([a-z0-9_]+)\]\]", lookup, template)
    return out.replace("[[ROOT]]", root)


# ---------- blog posts ----------

def parse_post(path):
    raw = open(path, encoding="utf-8").read()
    meta, body = {}, raw
    if raw.startswith("---"):
        _, front, body = raw.split("---", 2)
        for line in front.strip().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip()] = value.strip().strip('"').strip("'")
    slug = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", os.path.basename(path)[:-3])
    return {
        "slug": slug,
        "title": meta.get("title", slug),
        "date": meta.get("date", ""),
        "summary": meta.get("summary", ""),
        "cover": meta.get("cover", "1") if meta.get("cover", "1") in COVERS else "1",
        "body": body.strip(),
    }


def inline_md(text):
    text = esc(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*", r"<em>\1</em>", text)
    text = re.sub(r"\[(.+?)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def body_html(body):
    """Accepts simple Markdown (paragraphs, ## headings, **bold**, links) or ready HTML."""
    if re.search(r"<(p|h2|h3|ul|ol)[\s>]", body):
        return body
    parts = []
    for block in re.split(r"\n\s*\n", body):
        block = block.strip()
        if not block:
            continue
        if block.startswith("## "):
            parts.append('<h2 style="margin: 16px 0 0; font-size: 30px; line-height: 1.2; font-weight: 900">%s</h2>' % inline_md(block[3:]))
        elif all(line.lstrip().startswith(("- ", "* ")) for line in block.splitlines()):
            items = "".join("<li>%s</li>" % inline_md(line.lstrip()[2:]) for line in block.splitlines())
            parts.append('<ul style="margin: 0; padding-left: 24px; font-size: 21px; line-height: 1.7">%s</ul>' % items)
        else:
            parts.append('<p style="margin: 0; font-size: 21px; line-height: 1.7">%s</p>' % inline_md(block.replace("\n", " ")))
    return "\n".join(parts)


def read_minutes(body):
    return max(1, round(len(re.findall(r"\w+", body)) / 220))


def post_card(href, cover, label, title):
    bg, art = COVERS[cover]
    return (
        '<a class="lift" href="%s" style="text-decoration: none; display: flex; flex-direction: column; gap: 14px">\n'
        '<span aria-hidden="true" style="position: relative; overflow: hidden; height: 210px; border-radius: 32px; background: %s">%s</span>\n'
        '<span style="font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase">%s</span>\n'
        '<span style="font-size: 24px; font-weight: 800; line-height: 1.25">%s</span>\n'
        '<span style="font-size: 16px; font-weight: 800; text-decoration: underline">Read it</span>\n'
        "</a>\n" % (esc(href), bg, art, esc(label), esc(title))
    )


def substack_cards(url):
    """Latest three posts from a Substack feed. Returns '' if anything goes wrong."""
    feed = url.rstrip("/") + "/feed"
    try:
        req = urllib.request.Request(feed, headers={"User-Agent": "Mozilla/5.0 (site build)"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            tree = ET.fromstring(resp.read())
        cards = []
        for i, item in enumerate(tree.findall("./channel/item")[:3]):
            title = item.findtext("title") or ""
            link = item.findtext("link") or url
            try:
                date = parsedate_to_datetime(item.findtext("pubDate")).strftime("%-d %B %Y")
            except Exception:
                date = ""
            cards.append(post_card(link, str(i % 3 + 1), date, title))
        return "".join(cards)
    except Exception as err:  # keep the site building even if Substack is unreachable
        print("Substack feed not used:", err)
        return ""


# ---------- sections ----------

def gallery_html(items, root):
    out = []
    for k, item in enumerate(items):
        if not item.get("image"):
            continue
        cap = esc(item.get("caption", ""))
        out.append(
            '<figure class="polaroid" style="position: relative; margin: 0; background: #FFFFFF; padding: 12px 12px 14px; border-radius: 6px; box-shadow: 0 10px 24px rgba(45,42,62,0.18); transform: rotate(%ddeg); display: flex; flex-direction: column; gap: 8px; width: 212px; box-sizing: border-box">\n'
            '<span aria-hidden="true" style="position: absolute; left: 50%%; top: -12px; margin-left: -12px; width: 24px; height: 24px; border-radius: 50%%; background: %s; box-shadow: 0 3px 0 rgba(45,42,62,0.25)"></span>\n'
            '<img src="%s%s" alt="%s" loading="lazy" width="188" height="188" style="display: block; width: 188px; height: 188px; object-fit: cover; border-radius: 2px">\n'
            '<figcaption style="font-family: \'Caveat\', cursive; font-size: 23px; line-height: 1.05; text-align: center; min-height: 48px; display: flex; align-items: center; justify-content: center">%s</figcaption>\n'
            "</figure>\n" % (ROTS[k % 10], PINS[k % 4], root, esc(item["image"].lstrip("/")), cap, cap)
        )
    return "".join(out)


def listen_html(items):
    live = [i for i in items if i.get("url")]
    rows = live if live else items  # until real links are added, show the rows as placeholders
    out = []
    for k, item in enumerate(rows):
        colour = ROW_COLOURS[k % 3]
        bars = "".join(
            '<span class="%s" style="width: 6px; height: %dpx; border-radius: 3px; background: %s"></span>' % (EQ[(k + n) % 4], h, colour)
            for n, h in enumerate([16, 32, 22, 28])
        )
        out.append(
            '<a class="row" href="%s" style="text-decoration: none; color: #FFFFFF; background: #3D3954; border-radius: 28px; padding: 16px 24px 16px 16px; display: flex; align-items: center; gap: 18px">\n'
            '<span aria-hidden="true" style="flex: 0 0 60px; width: 60px; height: 60px; border-radius: 50%%; background: %s; display: flex; align-items: center; justify-content: center"><svg viewBox="0 0 24 24" style="width: 24px; height: 24px"><path d="M8 5l12 7-12 7z" fill="#2D2A3E"></path></svg></span>\n'
            '<span style="flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px"><span style="font-size: 21px; font-weight: 800">%s</span><span style="font-size: 15px; color: #D9D6E8">%s</span></span>\n'
            '<span aria-hidden="true" style="display: flex; align-items: flex-end; gap: 5px; height: 32px">%s</span>\n'
            "</a>\n" % (esc(item.get("url") or "#listen"), colour, esc(item.get("title")), esc(item.get("kind")), bars)
        )
    return "".join(out)


def youtube_id(url):
    m = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{6,})", url or "")
    return m.group(1) if m else ""


def audio_html(items, root):
    out = []
    for item in items:
        src = item.get("file") or ""
        if not src:
            continue
        if not src.startswith("http"):
            src = root + src.lstrip("/")
        tag = "video" if src.lower().endswith((".mp4", ".mov", ".webm")) else "audio"
        extra = ' style="width: 100%; border-radius: 16px"' if tag == "video" else ' style="width: 100%"'
        out.append(
            '<div style="background: #3D3954; border-radius: 28px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px">\n'
            '<span style="font-size: 19px; font-weight: 800">%s</span>\n'
            '<%s controls preload="none" src="%s"%s></%s>\n'
            "</div>\n" % (esc(item.get("title")), tag, esc(src), extra, tag)
        )
    return "".join(out)


def media_html(videos):
    cards = []
    for v in videos:
        vid = youtube_id(v.get("url"))
        if not vid:
            continue
        cards.append(
            '<figure style="margin: 0; display: flex; flex-direction: column; gap: 12px">\n'
            '<div style="position: relative; padding-top: 56.25%%; border-radius: 28px; overflow: hidden; background: #14121D">'
            '<button type="button" class="yt" data-yt="%s" data-title="%s" aria-label="Play video: %s" style="position: absolute; left: 0; top: 0; width: 100%%; height: 100%%; padding: 0; border: 0; background: #14121D; cursor: pointer">'
            '<img src="https://i.ytimg.com/vi/%s/hqdefault.jpg" alt="" loading="lazy" decoding="async" style="width: 100%%; height: 100%%; object-fit: cover; display: block">'
            '<span aria-hidden="true" style="position: absolute; left: 50%%; top: 50%%; width: 76px; height: 76px; margin: -38px 0 0 -38px; border-radius: 50%%; background: #FFCE00; color: #2D2A3E; display: flex; align-items: center; justify-content: center; font-size: 30px; padding-left: 6px; box-sizing: border-box; box-shadow: 0 6px 0 rgba(0,0,0,.35)">&#9654;</span>'
            '</button></div>\n'
            '<figcaption style="font-size: 19px; font-weight: 800; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px">%s <a href="https://www.youtube.com/watch?v=%s" style="color: #FFCE00; font-size: 16px">Watch on YouTube</a></figcaption>\n'
            "</figure>\n" % (vid, esc(v.get("title")), esc(v.get("title")), vid, esc(v.get("title")), vid)
        )
    if not cards:
        return ""
    return '<div style="flex: 1 1 100%%; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%%), 1fr)); gap: 24px">\n%s</div>\n' % "".join(cards)


def excerpt_html(text):
    if not (text or "").strip():
        return ""
    paras = "".join('<p style="margin: 0">%s</p>\n' % esc(p.strip()) for p in re.split(r"\n\s*\n", text) if p.strip())
    return (
        '<section style="max-width: 760px; margin: 0 auto; padding: 96px 32px 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 20px">\n'
        '<p style="margin: 0; font-size: 14px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase">Read an excerpt</p>\n'
        '<div style="position: relative; background: #FFFFFF; border: 3px solid #2D2A3E; border-radius: 36px; padding: 48px 40px; box-shadow: 10px 12px 0 #FFCE00; display: flex; flex-direction: column; gap: 22px; font-size: 21px; line-height: 1.7">\n%s</div>\n'
        "</section>\n" % paras
    )


def about_html(about):
    out = ['<p style="margin: 0">%s</p>\n' % esc(p) for p in about.get("paragraphs", []) if p]
    if about.get("highlight"):
        out.append('<p style="margin: 0; font-weight: 800; background: #FFF3C4; border-radius: 28px; padding: 24px 28px">%s</p>\n' % esc(about["highlight"]))
    return "".join(out)


ENDPOINT = ""
BASE = ""

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; "
       "frame-src https://www.youtube-nocookie.com; "
       "connect-src 'self' https://api.web3forms.com https://script.google.com https://script.googleusercontent.com https://api.hsforms.com; "
       "form-action 'self' https://api.web3forms.com; base-uri 'self'; object-src 'none'")


def page(title, description, body, root, canonical="", endpoint=None, kind="website", data=None, index=True):
    def tidy(m):
        tag = m.group(0)
        if not re.search(r"\swidth=", tag):
            size = re.search(r"width: (\d+)px; height: (\d+)px", tag)
            if size:
                tag = tag.replace("<img ", '<img width="%s" height="%s" ' % size.groups(), 1)
        if "jess-radio" in tag:
            return tag.replace("<img ", '<img fetchpriority="high" ', 1)
        if "loading=" in tag:
            return tag
        return tag.replace("<img ", '<img loading="lazy" decoding="async" ', 1)
    body = re.sub(r"<img [^>]*>", tidy, body)
    share = (BASE + "/assets/img/share.jpg") if BASE else root + "assets/img/share.jpg"
    extra = []
    if canonical:
        extra.append('<link rel="canonical" href="%s">' % esc(canonical))
        extra.append('<meta property="og:url" content="%s">' % esc(canonical))
    if not index:
        extra.append('<meta name="robots" content="noindex">')
    if "jess-radio" in body:
        extra.append('<link rel="preload" as="image" href="%sassets/img/jess-radio.jpg">' % root)
    for block in (data or []):
        extra.append('<script type="application/ld+json">%s</script>' % json.dumps(block, ensure_ascii=False).replace("</", "<\\/"))
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="%s">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>%s</title>
<meta name="description" content="%s">
<meta name="author" content="Jess Cruse">
<meta name="theme-color" content="#FFF3C4">
<meta property="og:site_name" content="Jess Cruse">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:type" content="%s">
<meta property="og:image" content="%s">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Jess Cruse smiling at a radio studio microphone, beside the words: I don't know you, but I know your voice matters.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%s">
<meta name="twitter:description" content="%s">
<meta name="twitter:image" content="%s">
<link rel="icon" href="%sassets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="%sassets/img/touch-icon.png">
%s
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Caveat:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="%sassets/site.css?v=8">
</head>
<body data-endpoint="%s">
<a class="skip" href="#main">Skip to content</a>
%s
<script src="%sassets/site.js?v=8" defer></script>
</body>
</html>
""" % (esc(CSP), esc(title), esc(description), esc(title), esc(description), kind, esc(share), esc(title), esc(description), esc(share),
       root, root, "\n".join(extra), root, esc(ENDPOINT if endpoint is None else endpoint), body, root)


def shrink_images():
    """Make a small, fast copy of every photo at the size it is actually shown, and point the pages at it."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        print("Pillow not installed: photos left at full size")
        return
    made = {}
    for folder, _, files in os.walk(DIST):
        for name in files:
            if not name.endswith(".html"):
                continue
            path = os.path.join(folder, name)
            page_html = read_abs(path)

            def swap(m):
                tag, src = m.group(0), m.group(1)
                if src.startswith(("http", "data:")) or not re.search(r"\.(jpe?g|png)$", src, re.I):
                    return tag
                source = os.path.join(DIST, src.lstrip("/")) if src.startswith("/") else os.path.normpath(os.path.join(folder, src))
                if not os.path.isfile(source):
                    return tag
                dims = [int(n) for n in re.findall(r'(?:width|height)="(\d+)"', tag)] or [int(n) for n in re.findall(r"(?:width|height): (\d+)px", tag)]
                target = min(1400, max(dims) * 2) if dims else 1000
                key = (source, target)
                if key not in made:
                    out = "%s-%d.webp" % (os.path.splitext(source)[0], target)
                    try:
                        im = ImageOps.exif_transpose(Image.open(source))
                        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
                        im.thumbnail((target, target), Image.LANCZOS)
                        im.save(out, "WEBP", quality=72, method=6)
                        made[key] = out if os.path.getsize(out) < os.path.getsize(source) else None
                    except Exception as err:
                        print("Could not shrink %s: %s" % (src, err))
                        made[key] = None
                if not made[key]:
                    return tag
                new_src = "%s-%d.webp" % (os.path.splitext(src)[0], target)
                return tag.replace('src="%s"' % src, 'src="%s"' % new_src, 1)

            new_html = re.sub(r'<img [^>]*?src="([^"]+)"[^>]*>', swap, page_html)
            hero = re.search(r'<img [^>]*fetchpriority="high"[^>]*src="([^"]+)"', new_html)
            if hero:
                new_html = re.sub(r'(<link rel="preload" as="image" href=")[^"]+(">)', lambda m: m.group(1) + hero.group(1) + m.group(2), new_html)
            if new_html != page_html:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_html)
    for (source, _), out in made.items():
        pass
    print("Shrunk %d photos" % len([o for o in made.values() if o]))


def check(site):
    """Stop the publish (the live site stays as it was) if an edit would break something."""
    problems = []
    for key, url in site.get("links", {}).items():
        if key == "email":
            if url and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", url):
                problems.append("links.email does not look like an email address: %r" % url)
        elif url and not url.startswith("https://"):
            problems.append("links.%s should start with https:// (got %r)" % (key, url))
    for folder, _, files in os.walk(DIST):
        for name in files:
            if not name.endswith(".html"):
                continue
            path = os.path.join(folder, name)
            html = read_abs(path)
            if "[[" in html:
                problems.append("%s still contains an unfilled [[placeholder]]" % os.path.relpath(path, DIST))
            for ref in set(re.findall(r'(?:href|src)="([^"#?]+)', html)):
                if re.match(r"^(https?:|mailto:|tel:|data:|//)", ref):
                    continue
                target = os.path.join(DIST, ref.lstrip("/")) if ref.startswith("/") else os.path.normpath(os.path.join(folder, ref))
                if not (os.path.isfile(target) or os.path.isfile(os.path.join(target, "index.html"))):
                    problems.append("%s links to something that does not exist: %s" % (os.path.relpath(path, DIST), ref))
    if problems:
        raise SystemExit("NOT PUBLISHED. Please fix:\n- " + "\n- ".join(problems))


def main():
    site = json.loads(read("content/site.json"))
    # Technical connections live in their own file so the edit screen can never remove them.
    for section, values in json.loads(read("content/connections.json")).items():
        for key, value in values.items():
            if not site.setdefault(section, {}).get(key):
                site[section][key] = value
    global ENDPOINT, BASE
    ENDPOINT = (site.get("automation", {}).get("endpoint", "") or "").strip()
    seo, links = site.get("seo", {}), site.get("links", {})
    base = (seo.get("site_url") or "").rstrip("/")
    BASE = base
    same_as = [links.get(k) for k in ("linkedin", "instagram", "substack", "linktree") if links.get(k)]
    about = site.get("about", {})
    person = {
        "@context": "https://schema.org", "@type": "Person", "@id": (base or "") + "/#jess", "name": "Jess Cruse",
        "url": (base or "") + "/", "image": (base or "") + "/assets/img/jess-radio.jpg",
        "jobTitle": "Voice confidence coach, speaker and founder of Voxa",
        "description": " ".join(about.get("paragraphs", [])[:1]) or seo.get("description", ""),
        "email": "mailto:" + links.get("email", ""),
        "worksFor": {"@type": "Organization", "name": "Voxa", "url": links.get("voxa", "")},
        "knowsAbout": ["Voice confidence", "Public speaking", "Storytelling", "Pitch coaching", "Communication skills training"],
        "sameAs": same_as,
    }
    website = {"@context": "https://schema.org", "@type": "WebSite", "name": "Jess Cruse", "url": (base or "") + "/", "inLanguage": "en-GB", "author": {"@id": (base or "") + "/#jess"}}

    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(DIST, "assets"))

    posts = sorted((parse_post(p) for p in glob.glob(os.path.join(ROOT, "content/posts/*.md"))), key=lambda p: p["date"], reverse=True)

    # Blog cards: Substack if a link is set and reachable, otherwise the posts in content/posts.
    # The feed needs the publication address (name.substack.com), not the profile page.
    cards = substack_cards(links["substack_publication"]) if links.get("substack_publication") else ""
    if not cards:
        cards = "".join(post_card("blog/%s/" % p["slug"], p["cover"], nice_date(p["date"]), p["title"]) for p in posts[:3])
    if links.get("substack"):
        more = '<a href="%s" style="font-size: 17px; font-weight: 800; padding: 12px 0">All my writing on Substack</a>' % esc(links["substack"])
    else:
        more = ""

    home = read("templates/home.html")
    home = home.replace("[[GALLERY]]", gallery_html(site.get("gallery", {}).get("items", []), ""))
    home = home.replace("[[POSTS]]", cards)
    listen = site.get("listen", {})
    home = home.replace("[[LISTEN]]", listen_html(listen.get("items", [])) + audio_html(listen.get("audio", []), ""))
    home = home.replace("[[MEDIA]]", media_html(listen.get("videos", [])))
    home = home.replace("[[ABOUT]]", about_html(site.get("about", {})))
    home = home.replace("[[SUBSTACK_LINK]]", more)
    note = esc(site.get("footer", {}).get("note", ""))
    mail = esc(links.get("email", ""))
    if note and mail:
        note = note.replace(mail, '<a href="mailto:%s" style="color: #FFFFFF">%s</a>' % (mail, mail))
    home = home.replace("[[FOOTER_NOTE]]", '<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #D9D6E8; max-width: 640px">%s</p>\n' % note if note else "")
    home = fill(home, site, "")
    write("index.html", page(seo.get("title", "Jess Cruse"), seo.get("description", ""), home, "", base + "/" if base else "", data=[person, website]))

    post_tpl = read("templates/post.html")
    for p in posts:
        bg, art = COVERS[p["cover"]]
        body = post_tpl.replace("[[POST_BG]]", bg).replace("[[POST_ART]]", art)
        body = body.replace("[[POST_TITLE]]", esc(p["title"])).replace("[[POST_META]]", esc("%s · %d min read" % (nice_date(p["date"]), read_minutes(p["body"]))))
        body = body.replace("[[POST_BODY]]", body_html(p["body"]))
        body = fill(body, site, "../../")
        canonical = "%s/blog/%s/" % (base, p["slug"]) if base else ""
        article = {
            "@context": "https://schema.org", "@type": "BlogPosting", "headline": p["title"], "description": p["summary"],
            "datePublished": str(p["date"]), "dateModified": str(p["date"]), "inLanguage": "en-GB",
            "author": {"@type": "Person", "name": "Jess Cruse", "url": (base or "") + "/"},
            "mainEntityOfPage": canonical, "image": (base or "") + "/assets/img/share.jpg",
        }
        write("blog/%s/index.html" % p["slug"], page(p["title"] + " | Jess Cruse", p["summary"], body, "../../", canonical, kind="article", data=[article]))

    book = read("templates/book.html").replace("[[EXCERPT]]", excerpt_html(site.get("book", {}).get("excerpt", "")))
    book = fill(book, site, "../")
    book_info = site.get("book", {})
    book_desc = "A Book About Voice by Jess Cruse: %s %s. Read more and pre-order your copy." % (book_info.get("blurb", "").replace(" I'm writing it now.", ""), book_info.get("release", ""))
    book_data = {
        "@context": "https://schema.org", "@type": "Book", "name": "A Book About Voice", "author": {"@type": "Person", "name": "Jess Cruse", "url": (base or "") + "/"},
        "description": book_info.get("blurb", ""), "inLanguage": "en", "url": (base or "") + "/book/",
    }
    write("book/index.html", page("A Book About Voice | Jess Cruse", book_desc, book, "../", base + "/book/" if base else "", kind="book", data=[book_data]))

    privacy = fill(read("templates/privacy.html"), site, "../")
    write("privacy/index.html", page("Privacy | Jess Cruse", "How jesscruse.com handles your information, in plain words: pre-orders, visit counting and other services.", privacy, "../", base + "/privacy/" if base else ""))
    write("404.html", page("Page not found | Jess Cruse", "This page could not be found.", fill(read("templates/404.html"), site, "/"), "/", index=False))

    write(".nojekyll", "")
    if os.path.exists(os.path.join(ROOT, "CNAME")):
        shutil.copy(os.path.join(ROOT, "CNAME"), os.path.join(DIST, "CNAME"))
    if base:
        today = time.strftime("%Y-%m-%d")
        urls = [(base + "/", today), (base + "/book/", today)] + [("%s/blog/%s/" % (base, p["slug"]), str(p["date"])) for p in posts] + [(base + "/privacy/", today)]
        write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s</urlset>\n' % "".join("<url><loc>%s</loc><lastmod>%s</lastmod></url>\n" % (esc(u), d) for u, d in urls))
        write("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n" % base)
    # A plain summary for AI assistants and search tools, built only from what the site itself says.
    lines = ["# Jess Cruse", "", "> " + seo.get("description", ""), "",
             "Jess Cruse is a voice confidence coach, speaker and the founder of Voxa, a voice confidence app.", ""]
    if about.get("paragraphs"):
        lines += ['In her own words: "%s"' % about["paragraphs"][0], ""]
    lines += ["## What Jess offers", "",
              "- One to one voice confidence coaching. Book a discovery call: %s" % links.get("calendly", ""),
              "- Team training in communication and speaking skills. Enquiries: %s" % links.get("email", ""),
              "- Speaking: stages, panels, podcasts and workshops. Enquiries: %s" % links.get("email", ""),
              "- Voxa, an app to practise speaking right now: %s" % links.get("voxa", ""),
              "- A Book About Voice (%s), a practical and honest book about voice confidence. Pre-order: %s/book/" % (book_info.get("release", "").lower(), base), "",
              "## Pages", "", "- Home: %s/" % base, "- The book: %s/book/" % base]
    lines += ["- %s: %s/blog/%s/" % (p["title"], base, p["slug"]) for p in posts]
    lines += ["- Privacy: %s/privacy/" % base, "", "## Elsewhere", ""]
    lines += ["- %s: %s" % (k.capitalize(), links[k]) for k in ("linkedin", "instagram", "substack", "linktree") if links.get(k)]
    write("llms.txt", "\n".join(lines) + "\n")
    shrink_images()
    check(site)
    print("Built %d pages into dist/" % (3 + len(posts)))


if __name__ == "__main__":
    main()
