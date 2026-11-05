import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The guide is the site: no splash page in front of it.
  async redirects() {
    return [{ source: '/', destination: '/docs', permanent: false }];
  },
};

export default withMDX(config);
