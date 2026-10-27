export const projectId = import.meta.env.VITE_SANITY_PROJECT_ID as string
export const dataset = import.meta.env.VITE_SANITY_DATASET as string
export const apiVersion =
  (import.meta.env.VITE_SANITY_API_VERSION as string | undefined) ?? '2026-10-26'

export function assertSanityEnv() {
  if (!projectId || !dataset) {
    throw new Error(
      'Missing VITE_SANITY_PROJECT_ID or VITE_SANITY_DATASET. Copy .env.example to .env.local.',
    )
  }
}
