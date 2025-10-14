/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // This tells Next.js not to try to bundle these native modules
    serverComponentsExternalPackages: ['duckdb', '@mapbox/node-pre-gyp'],
  },
  webpack: (config, { isServer }) => {
    // Let Webpack treat .html files as raw text instead of JS
    config.module.rules.push({
      test: /\.html$/i,
      type: 'asset/source',
    });

    // Prevent client-side bundle from crashing if something touches fs/path
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
      };
    }

    return config;
  },
};

export default nextConfig;
