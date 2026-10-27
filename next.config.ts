import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Task 95 (P1 quality gate): build ab type-errors par FAIL hota hai —
  // tsc baseline 0 errors hai aur CI typecheck job bhi hard gate hai.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Task 95: powered-by header band (attack surface kam)
  poweredByHeader: false,
  reactStrictMode: false,
};

export default nextConfig;
