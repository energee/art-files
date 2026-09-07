export const appName = 'Label Lab';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

const gitConfig = {
  user: 'energee',
  repo: 'art-files',
  branch: 'main',
};

export const githubRepoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export function githubFileUrl(path: string) {
  return `${githubRepoUrl}/blob/${gitConfig.branch}/${path}`;
}
