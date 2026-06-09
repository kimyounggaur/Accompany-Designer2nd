import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VERCEL ? "/" : "/Accompany-Designer2nd/",
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name].js",
        entryFileNames: "assets/[name].js",
      },
    },
  },
  plugins: [],
});
