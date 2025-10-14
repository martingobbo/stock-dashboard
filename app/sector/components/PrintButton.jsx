'use client'

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
      title="Save this page as PDF"
    >
      {/* printer icon */}
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 2h12v6h-2V4H8v4H6V2zm-2 8h16a2 2 0 0 1 2 2v6h-4v4H6v-4H2v-6a2 2 0 0 1 2-2zm4 12h8v-4H8v4zm8.5-10h-9a1.5 1.5 0 1 0 0 3h9a1.5 1.5 0 1 0 0-3z"/>
      </svg>
      Download PDF
    </button>
  )
}
