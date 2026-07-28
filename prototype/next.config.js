/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow both localhost and 127.0.0.1 for HMR in development
  allowedDevOrigins: ['localhost', '127.0.0.1', 'localhost:3000', '127.0.0.1:3000'],
};

module.exports = nextConfig;
