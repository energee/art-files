# Label Lab user guide

The Fumadocs site for using Label Lab: masters, layers, preview, export, the generate CLI.

```bash
# from the repository root. Always `npm ci`: an install that drifted from
# package-lock.json can fail `next build`.
npm ci --prefix docs-site
npm run dev --prefix docs-site

# or from this directory
npm ci
npm run dev
```

Open http://localhost:3000; it redirects to the guide at /docs.

Set `SITE_URL` to the public origin when hosting; OG images, `/sitemap.xml` and `/robots.txt` use it, and it defaults to `http://localhost:3000`.

Pages live in [`content/docs`](content/docs). The root README keeps the small technical bits: install, generate, CMYK, layout.
