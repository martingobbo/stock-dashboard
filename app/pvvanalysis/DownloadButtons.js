'use client'

import { useCallback, useState } from 'react'
import { Download, Printer } from 'lucide-react'

export default function DownloadButtons({ targetId = 'pvv-root', filename = 'pvv_dashboard.pdf' }) {
  const [busy, setBusy] = useState(false)

  const handlePrint = useCallback(() => window.print(), [])

  const handleDownloadPDF = useCallback(async () => {
    const el = document.getElementById(targetId)
    if (!el) return

    setBusy(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])

      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const imgData = canvas.toDataURL('image/png')

      const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const imgWidth = pageWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      let heightLeft = imgHeight
      let position = 0
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST')
      heightLeft -= pageHeight

      while (heightLeft > 0) {
        pdf.addPage()
        position = heightLeft - imgHeight
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST')
        heightLeft -= pageHeight
      }

      pdf.save(filename)
    } catch (e) {
      console.error(e)
      alert('Could not generate PDF. Try Print → Save as PDF.')
    } finally {
      setBusy(false)
    }
  }, [targetId, filename])

  return (
    <div className="flex gap-2">
      <button
        onClick={handlePrint}
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
      >
        <Printer className="h-4 w-4" /> Print / Save PDF
      </button>
      <button
        onClick={handleDownloadPDF}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
      >
        <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download PDF'}
      </button>
    </div>
  )
}
