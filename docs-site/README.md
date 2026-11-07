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

`npm run build` writes a static site to `out/`, with search as a prebuilt index. `.github/workflows/docs-deploy.yml` publishes it to https://energ.ee/label-lab-docs/ on every change to `main`, through the `gh-pages` branch of `energee/label-lab-docs`. It is a separate repository because this one's Pages site carries the updater feed.

The build reads `SITE_URL` (the public URL, for OG images, `/sitemap.xml` and `/robots.txt`; default `http://localhost:3000`) and `BASE_PATH` (the path it is served under; default none).

Pages live in [`content/docs`](content/docs). The root README keeps the small technical bits: install, generate, CMYK, layout.
