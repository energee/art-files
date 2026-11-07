export const appName = 'Label Lab';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const githubRepoUrl = 'https://github.com/energee/art-files';

// The path the site is served under, and its absolute URL for OG images, the
// sitemap and robots.txt. docs-deploy.yml sets both at build time.
export const basePath = process.env.BASE_PATH ?? '';
export const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000';
