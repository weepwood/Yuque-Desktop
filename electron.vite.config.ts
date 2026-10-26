import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {},
  preload: {
    // Required for sandboxed preload: only Electron's built-in IPC API is exposed.
    build: { externalizeDeps: false }
  },
  renderer: {
    base: './',
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [vue()]
  }
})
