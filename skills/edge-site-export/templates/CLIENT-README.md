# {{siteName}}: your website files

This folder is a complete copy of {{siteName}} as it was published on
{{exportDate}}. It runs on its own: it needs no CMS, database or service of
ours, and it can be hosted anywhere that serves static files.

## What is here

| Folder | What it is |
| --- | --- |
| `site/` | The website: {{pageCount}} pages{{postSummary}}, with every image, font, stylesheet and script it uses. Upload this folder's contents to your host. |
| `content/` | Your content in portable formats: each page and post as JSON, each post also as Markdown, and `wordpress-export.xml` for importing the posts into WordPress. |

## Putting the site online

Any static host works. Three common choices:

- **Netlify** or **Cloudflare Pages**: create a site and upload (or drag in)
  the `site/` folder. Both read the `_redirects` file{{redirectNote}}.
- **Your current web host (cPanel or FTP)**: upload everything inside `site/`
  to the web root (often `public_html`).
- **Amazon S3, GitHub Pages and similar**: upload `site/` and set
  `index.html` as the index document and `404.html` as the error page.

Then point your domain at the new host (your host gives the DNS records to
set). The site expects to live at **https://{{domain}}/**; its canonical links,
sitemap and social previews use that address.

## Forms

{{formsSection}}

## Editing the site

Pages are plain HTML files (`site/<page>/index.html`). Any web developer can
edit them, or you can rebuild the site in another CMS from the files in
`content/`:

- **WordPress**: Tools → Import → WordPress, and choose
  `content/wordpress-export.xml`. Posts, dates, excerpts and tags come in;
  images load from your new site, so put `site/` online first.
- **Other platforms** (Squarespace, Webflow, Hugo, Astro...): the Markdown
  files in `content/posts/` carry each post's title, date, tags and summary
  at the top.

## What works differently now

{{differences}}

## Files worth knowing

- `site/assets/edge-standalone-config.js`: form and icon settings.
- `site/sitemap.xml` and `site/robots.txt`: submit the sitemap in Google Search Console once the site is live.{{rssNote}}
