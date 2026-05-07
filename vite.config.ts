import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { htmlEntryAsEsmPlugin } from './vite/htmlEntryAsEsm'

// https://vite.dev/config/
export default defineConfig({
  plugins: [htmlEntryAsEsmPlugin(), react()],
  envDir: process.cwd(),
  server: {
    port: 3000,
  },
})
