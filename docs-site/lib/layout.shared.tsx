import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, docsRoute, githubRepoUrl } from './shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: appName,
  },
  githubUrl: githubRepoUrl,
  links: [
    {
      text: 'User guide',
      url: docsRoute,
      active: 'nested-url',
    },
  ],
};
