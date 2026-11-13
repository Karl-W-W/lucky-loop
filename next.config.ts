import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Karl's ruling of 2026-10-02 (answer retire-war-and-loop): the two public
   * dashboards leave the site, which becomes the offer, the legal pages and
   * contact. The first line is the route files themselves (app/war/page.tsx,
   * app/loop/page.tsx), which send a visitor home. These redirects are the
   * second line, and they also name the data routes (.rsc, .segments) that the
   * page paths alone do not match. TEMPORARY (307), so undoing it is deleting
   * this block, with no redirect cached forever in a visitor's browser.
   * Deleting the retired code is a follow-up. */
  async redirects() {
    return [
      { source: "/war", destination: "/", permanent: false },
      { source: "/war/:path*", destination: "/", permanent: false },
      { source: "/war.rsc", destination: "/", permanent: false },
      { source: "/war.segments/:path*", destination: "/", permanent: false },
      { source: "/loop", destination: "/", permanent: false },
      { source: "/loop/:path*", destination: "/", permanent: false },
      { source: "/loop.rsc", destination: "/", permanent: false },
      { source: "/loop.segments/:path*", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
