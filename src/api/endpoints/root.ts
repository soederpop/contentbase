export const path = '/'
export const description = 'Redirect to docs table of contents when no static index.html exists'
export const tags = ['docs']

export async function get(_params: any, ctx: any) {
  ctx.response.redirect('/docs/')
}
