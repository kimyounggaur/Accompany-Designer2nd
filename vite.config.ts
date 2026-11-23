import { defineConfig } from "vite";

// The Vercel deployment is served from the domain root. GitHub Pages passes
// its repository path explicitly through the build:pages script.
export default defineConfig({
  base: "/",
});
