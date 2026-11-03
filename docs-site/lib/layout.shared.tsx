import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, githubRepoUrl } from './shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img src="/logo.png" alt="" width={24} height={24} />
        {appName}
      </>
    ),
  },
  githubUrl: githubRepoUrl,
};
