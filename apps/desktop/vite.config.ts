import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs: Electron loads the build from file://, Capacitor from its own origin.
  base: "./",
  plugins: [react()],
  server: { port: 1420 },
});
