export function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}
