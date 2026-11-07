import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, basePath, githubRepoUrl } from './shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img src={`${basePath}/logo.png`} alt="" width={24} height={24} />
        {appName}
      </>
    ),
  },
  githubUrl: githubRepoUrl,
};
