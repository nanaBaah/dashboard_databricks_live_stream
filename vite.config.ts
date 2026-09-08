import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the AppKit client (React).
 *
 * The project root holds `index.html` (which loads `src/client/main.tsx`), so
 * Vite's root is this directory. The AppKit `server` plugin runs this config as
 * a dev server in development (`npm run dev`) and serves the `dist/` output in
 * production (`npm run start`).
 *
 * @tailwindcss/vite is required because @databricks/appkit-ui/styles.css
 * uses `@import "tailwindcss"` (Tailwind v4 syntax).
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "client_bundle",
    emptyOutDir: true,
  },
});
