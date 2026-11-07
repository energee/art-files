import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Plain files for GitHub Pages: no server, so no redirects, rewrites or proxy.
  output: 'export',
  basePath: process.env.BASE_PATH ?? '',
  images: { unoptimized: true },
};

export default withMDX(config);
