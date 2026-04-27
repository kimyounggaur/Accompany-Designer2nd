import { defineConfig } from "vite";

export default defineConfig({
  base: "/Accompany-Designer2nd/",
  build: {
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
