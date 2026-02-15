import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Загружаем переменные из .env на основе текущего режима (development/production)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/hello': {
          target: env.VITE_API_URL, // Берем адрес из .env
          changeOrigin: true,
          secure: false,
        },
        '/logs': {
          target: env.VITE_API_URL, // И тут тоже
          changeOrigin: true,
          secure: false,
        },
      }
    }
  }
})