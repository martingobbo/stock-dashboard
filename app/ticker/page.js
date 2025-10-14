// app/fundamentals/page.js
// Server component wrapper that renders the client dashboard

import 'server-only'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import ClientFundamentals from './ClientFundamentals'

export default async function Page() {
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-1">Fundamentals Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Overview | FY | Quarterly for revenue, earnings, FCF, margins, EBITDA, and acceleration.
      </p>
      <ClientFundamentals />
    </main>
  )
}
