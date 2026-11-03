import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    // GitHub's comment grey (#6a737d) fails AA on both code backgrounds;
    // darken it in light mode and lighten it in dark mode.
    mdxOptions: applyMdxPreset({
      rehypeCodeOptions: {
        themes: { light: 'github-light', dark: 'github-dark' },
        colorReplacements: {
          'github-light': { '#6a737d': '#57606a' },
          'github-dark': { '#6a737d': '#8b949e' },
        },
      },
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

type DocsPage = (typeof source)['$inferPage'];

function pageAssetUrl(page: DocsPage, route: string, fileName: string) {
  const segments = [...page.slugs, fileName];
  const parts = [page.locale, ...route.split('/'), ...segments].filter(Boolean);

  return {
    segments,
    url: `/${parts.join('/')}`,
  };
}

export function getPageImageUrl(page: DocsPage) {
  return pageAssetUrl(page, docsImageRoute, 'image.png');
}

export function getPageMarkdownUrl(page: DocsPage) {
  return pageAssetUrl(page, docsContentRoute, 'content.md');
}

export async function getLLMText(page: DocsPage) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
