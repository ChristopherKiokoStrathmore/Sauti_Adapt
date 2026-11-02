/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sauti/shared'],
  webpack: (config) => {
    // Kept explicit: the Controller is the OFFICIAL pinned toolkit, not a reimplementation.
    return config;
  }
};
export default nextConfig;
