// The Next.js component only needs createElement; React comes from the user's app.
declare module 'react' {
  export function createElement(type: string, props: Record<string, unknown> | null): any
}
