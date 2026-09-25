/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coverartarchive.org" },
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "images.genius.com" },
    ],
  },
};

export default nextConfig;
