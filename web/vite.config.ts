import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { chatPlugin } from './server/chat.ts'

// https://vite.dev/config/
export default defineConfig({
  // chatPlugin adds POST /api/chat to the dev server (holds the API key; see server/chat.ts).
  plugins: [react(), chatPlugin()],
})
