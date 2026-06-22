import { useEffect, useRef, type JSX } from 'react'
import { useSeparations } from '../state/separations.context'
import {
  compositeImageData,
  compositeGrayImageData,
  compositeRgbImageData,
  compositeRgbGrayImageData
} from '../services/separation-utils'

/**
 * Overlay de separación sobre una página: cuando el modo está activo, muestra el
 * compuesto de las tintas activas EN EL PROPIO DOCUMENTO, recalculado en vivo.
 */
export function SeparationLayer({ pageNumber }: { pageNumber: number }): JSX.Element | null {
  const { active, enabled, grayView, space, ensurePage, getPlates } = useSeparations()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (active) ensurePage(pageNumber)
  }, [active, pageNumber, ensurePage])

  const plates = getPlates(pageNumber)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active || !plates || plates.length === 0) return
    const isRgb = space === 'rgb'
    const img = grayView
      ? (isRgb ? compositeRgbGrayImageData : compositeGrayImageData)(plates, enabled)
      : (isRgb ? compositeRgbImageData : compositeImageData)(plates, enabled)
    canvas.width = img.width
    canvas.height = img.height
    canvas.getContext('2d')?.putImageData(img, 0, 0)
  }, [active, plates, enabled, grayView, space])

  if (!active) return null

  return (
    <div className="sep-overlay">
      {(!plates || plates.length === 0) && <div className="sep-loading">Separando…</div>}
      <canvas
        ref={canvasRef}
        className="sep-overlay-canvas"
        style={{ display: plates && plates.length > 0 ? 'block' : 'none' }}
      />
    </div>
  )
}
