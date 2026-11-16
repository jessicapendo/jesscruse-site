#!/usr/bin/env python3
"""Builds the site into ./dist from templates/ and content/.

No installs needed: this uses only Python's standard library.
Run:  python3 build.py
"""
import glob
import html
import json
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
    out = re.sub(r"\[\[([a-z]+)\.([a-z_]+)\]\]", lookup, template)
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


def about_html(about):
    out = ['<p style="margin: 0">%s</p>\n' % esc(p) for p in about.get("paragraphs", []) if p]
    if about.get("highlight"):
        out.append('<p style="margin: 0; font-weight: 800; background: #FFF3C4; border-radius: 28px; padding: 24px 28px">%s</p>\n' % esc(about["highlight"]))
    return "".join(out)


def page(title, description, body, root, canonical=""):
    head_extra = '<link rel="canonical" href="%s">\n' % esc(canonical) if canonical else ""
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<meta name="description" content="%s">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:type" content="website">
<meta property="og:image" content="%sassets/img/jess-radio.jpg">
%s<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Caveat:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="%sassets/site.css">
</head>
<body>
%s
<script src="%sassets/site.js" defer></script>
</body>
</html>
""" % (esc(title), esc(description), esc(title), esc(description), root, head_extra, root, body, root)


def main():
    site = json.loads(read("content/site.json"))
    seo, links = site.get("seo", {}), site.get("links", {})
    base = (seo.get("site_url") or "").rstrip("/")

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
    home = home.replace("[[LISTEN]]", listen_html(site.get("listen", {}).get("items", [])))
    home = home.replace("[[ABOUT]]", about_html(site.get("about", {})))
    home = home.replace("[[SUBSTACK_LINK]]", more)
    home = fill(home, site, "")
    write("index.html", page(seo.get("title", "Jess Cruse"), seo.get("description", ""), home, "", base + "/" if base else ""))

    post_tpl = read("templates/post.html")
    for p in posts:
        bg, art = COVERS[p["cover"]]
        body = post_tpl.replace("[[POST_BG]]", bg).replace("[[POST_ART]]", art)
        body = body.replace("[[POST_TITLE]]", esc(p["title"])).replace("[[POST_META]]", esc("%s · %d min read" % (nice_date(p["date"]), read_minutes(p["body"]))))
        body = body.replace("[[POST_BODY]]", body_html(p["body"]))
        body = fill(body, site, "../../")
        canonical = "%s/blog/%s/" % (base, p["slug"]) if base else ""
        write("blog/%s/index.html" % p["slug"], page(p["title"] + " | Jess Cruse", p["summary"], body, "../../", canonical))

    privacy = fill(read("templates/privacy.html"), site, "../")
    write("privacy/index.html", page("Privacy | Jess Cruse", "How this site handles your information.", privacy, "../"))

    write(".nojekyll", "")
    if os.path.exists(os.path.join(ROOT, "CNAME")):
        shutil.copy(os.path.join(ROOT, "CNAME"), os.path.join(DIST, "CNAME"))
    if base:
        urls = [base + "/"] + ["%s/blog/%s/" % (base, p["slug"]) for p in posts]
        write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s</urlset>\n' % "".join("<url><loc>%s</loc></url>\n" % esc(u) for u in urls))
        write("robots.txt", "User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n" % base)
    print("Built %d pages into dist/" % (2 + len(posts)))


if __name__ == "__main__":
    main()
