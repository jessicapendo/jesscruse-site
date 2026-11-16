# jesscruse.com

Jess Cruse's personal website: a home page, a gallery and a blog.

## How it works

- `content/site.json` holds every editable word, link and gallery photo on the home page.
- `content/posts/` holds blog posts, one file each.
- `templates/` and `assets/` hold the design.
- `build.py` turns all of that into the finished site in `dist/`. It needs only Python 3, with nothing to install.
- `.github/workflows/deploy.yml` runs the build and publishes to GitHub Pages on every change, and once a day.

## Editing without code

Sign in at https://app.pagescms.org with the GitHub account that owns this repository. `.pages.yml` sets up the editing screens: **Home page** and **Blog posts**. Saving there publishes the change in about a minute.

## Blog

`links.substack` is where the "All my writing on Substack" button goes.
If `links.substack_publication` is empty, the home page shows the three newest posts from `content/posts/`.
If it holds a publication address (https://name.substack.com), the home page shows the three newest Substack posts instead, refreshed daily.

## Custom domain

Add a file named `CNAME` at the top level containing only the domain (for example `jesscruse.com`), set `seo.site_url` to the full address, and point the domain's DNS at GitHub Pages.

## Preview locally

    python3 build.py
    python3 -m http.server --directory dist 8000
