import { createClient } from '@blinkdotnew/sdk'

export const blink = createClient({
  projectId: import.meta.env.VITE_BLINK_PROJECT_ID || 'neonspace-dashboard-f0u108a8',
  publishableKey: import.meta.env.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_Gmbla-B0zF8toY7C-PsAtAX30XQJxrTg',
  authRequired: false,
  auth: { mode: 'managed' },
})
