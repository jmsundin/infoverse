import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        showMaximumFileSizeToCacheInBytesWarning: true,
        devOptions: {
          enabled: true,
        },
        workbox: {
          // Keep SW generation stable: Workbox production minification can hang
          // on this bundle shape, while development mode avoids that terser step.
          mode: "development",
          // Keep precache focused on stable core assets; very large hashed JS chunks
          // should be fetched at runtime instead of inflating/breaking SW generation.
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024, // 2 MB
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname === "/manifest.webmanifest",
              handler: "CacheFirst",
              options: {
                cacheName: "infoverse-manifest",
              },
            },
          ],
        },
        includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
        manifest: {
          name: "Infoverse",
          short_name: "Infoverse",
          description: "Your personal knowledge universe",
          theme_color: "#ffffff",
          icons: [
            {
              src: "pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
