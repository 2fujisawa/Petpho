import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server be reached from other devices on the LAN (e.g. testing
  // the login flow from a phone). Set DEV_ALLOWED_ORIGINS="192.168.1.20,…" in
  // .env.local; nothing personal is committed here.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
