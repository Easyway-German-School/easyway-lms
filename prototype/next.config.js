/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow both localhost and 127.0.0.1 for HMR in development
  allowedDevOrigins: ['localhost', '127.0.0.1', 'localhost:3000', '127.0.0.1:3000'],

  webpack: (config, { dev }) => {
    if (dev) {
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
