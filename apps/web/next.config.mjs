/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Controller stays the pinned upstream toolkit. There is no local reimplementation to bundle.
  transpilePackages: ['@sauti/shared'],
  // Playwright opens the dev server at 127.0.0.1. Next 16 blocks that host unless it is listed.
  allowedDevOrigins: ['127.0.0.1'],
};
export default nextConfig;
