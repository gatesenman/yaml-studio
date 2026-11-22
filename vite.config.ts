import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the production build works when loaded from file://
  // inside the packaged Electron app.
  base: './',
  plugins: [react()],
})
