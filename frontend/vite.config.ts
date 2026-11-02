import { defineConfig } from "vite";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  // Prevent Vite from obscuring Rust compiler errors and panics in terminal
  clearScreen: false,

  server: {
    // Force IPv4 loopback to avoid Windows IPv6 (::1) localhost resolution issues
    host: "127.0.0.1",
    port: 1420,
    // Fail immediately if port is in use, rather than silently picking another port
    strictPort: true,
  },

  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
});

