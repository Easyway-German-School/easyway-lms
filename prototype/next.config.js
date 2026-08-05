const path = require('path');
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow both localhost and 127.0.0.1 for HMR in development
  allowedDevOrigins: ['localhost', '127.0.0.1', 'localhost:3000', '127.0.0.1:3000'],

  /**
   * There is a stray, empty package-lock.json sitting in C:\Users\HP. Next sees
   * two lockfiles, picks the higher one, and decides the workspace root is the
   * whole home directory — so file tracing walks Documents, Downloads, OneDrive
   * and AppData looking for modules. On a 8GB machine that is what produces
   * `RangeError: Failed to allocate memory` before a single page compiles.
   *
   * Pinning the root to this folder is the fix. Deleting the stray lockfile
   * would also work, but pinning survives it coming back.
   */
  outputFileTracingRoot: __dirname,

  experimental: {
    // Trades a little rebuild speed for a much smaller webpack heap. Worth it:
    // dev was dying on allocation, not waiting on the CPU.
    webpackMemoryOptimizations: true,
  },

  webpack: (config, { dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'motion-dom$': path.resolve(__dirname, 'node_modules', 'motion-dom', 'dist', 'cjs', 'index.js'),
      'motion-dom': path.resolve(__dirname, 'node_modules', 'motion-dom', 'dist', 'cjs', 'index.js'),
    };

    if (dev) {
      // Webpack's default dev cache is written to disk and grows without bound
      // — .next/cache had reached 1.5GB. In memory, capped, it costs a cold
      // start after a restart and nothing else.
      config.cache = { type: 'memory', maxGenerations: 1 };
      // The SQLite database lives inside the project, so webpack's watcher
      // treats ordinary writes as source changes. Any request that touches the
      // DB triggers a recompile and a hot reload — and when that reload itself
      // writes to the DB (marking a channel read, say), it loops forever.
      config.watchOptions = {
        ...config.watchOptions,
        // *.db* also covers the -journal, -wal and -shm files SQLite writes.
        ignored: ['**/node_modules/**', '**/.git/**', '**/prisma/*.db*'],
      };
    }
    return config;
  },
};

module.exports = nextConfig;
