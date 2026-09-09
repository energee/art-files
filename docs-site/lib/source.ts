import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
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
