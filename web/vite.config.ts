import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The backend allows any origin (CORS), so the app calls VITE_API_URL directly — no dev proxy needed.
export default defineConfig({
  plugins: [react()],
})
