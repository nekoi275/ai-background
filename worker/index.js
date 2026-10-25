const API_PREFIX = '/api/'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) {
      return env.ASSETS.fetch(request)
    }

    if (!env.API_TOKEN || !env.MODAL_API_URL) {
      return new Response(
        'Worker is misconfigured: set the API_TOKEN secret and MODAL_API_URL var.',
        { status: 500 },
      )
    }

    const target = new URL(
      env.MODAL_API_URL.replace(/\/+$/, '') + url.pathname + url.search,
    )
    const upstream = new Request(target, request)
    upstream.headers.set('Authorization', `Bearer ${env.API_TOKEN}`)
    return fetch(upstream)
  },
}
