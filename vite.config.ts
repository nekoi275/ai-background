import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = (env.MODAL_API_URL ?? '').replace(/\/+$/, '')
  const token = (env.API_TOKEN ?? '').trim()

  if (command === 'serve' && (!target || !token)) {
    throw new Error(
      'Dev server needs MODAL_API_URL and API_TOKEN in .env.local ' +
        '(the Modal app URL and the token from the "ai-background" secret) ' +
        'to proxy /api/* requests.',
    )
  }

  return {
    server:
      command === 'serve'
        ? {
            proxy: {
              '/api': {
                target,
                changeOrigin: true,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
          }
        : undefined,
  }
})
