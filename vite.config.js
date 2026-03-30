import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  base: '/esp32-drum-monitor/',
  plugins: [svelte()],
  server: { port: 5174, host: true },
  preview: { port: 5174, host: true },
})
