import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server be reached from other devices on the LAN (e.g.
  // testing the login flow from a phone or another computer).
  allowedDevOrigins: ["192.168.1.203"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "replicate.delivery",
      },
      {
        protocol: "https",
        hostname: "**.replicate.delivery",
      },
    ],
  },
};

export default nextConfig;
