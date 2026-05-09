import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  compress: true,
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "prisma"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },
};
//why is each property used here? list them and explain their purpose, and also mention if there are any potential issues or improvements that can be made to this configuration
// - compress: Enables gzip compression for the response body
// - reactStrictMode: Enables React's strict mode for better error detection
// - serverExternalPackages: Specifies packages that should be treated as external on the server
// - images: Configures image optimization settings
// - logging: Configures logging options for fetch requests

export default nextConfig;
