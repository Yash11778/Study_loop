import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared contracts package ships TypeScript source, so Next compiles it
  // rather than treating it as a prebuilt dependency.
  transpilePackages: ["@study-loop/shared"],

  // Don't advertise the framework version to anyone scanning for known CVEs.
  poweredByHeader: false,

  // A build that typechecks locally but not in CI is a build that ships broken,
  // so type errors stay blocking. (Next 16 removed the `eslint` config key;
  // linting is run separately rather than during the build.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
