import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Unit tests only; browser tests in tests/e2e run with Playwright (npm run test:e2e)
    include: ['tests/unit/**/*.test.js'],
  },
})
