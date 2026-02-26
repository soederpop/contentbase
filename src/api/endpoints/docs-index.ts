export const path = '/docs'
export const description = 'Redirect to docs table of contents'
export const tags = ['docs']

export async function get(_params: any, ctx: any) {
  ctx.response.redirect('/docs/')
}
