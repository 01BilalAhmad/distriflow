'use client'

/**
 * 3-unit (Ctn / Box / Pcs) qty helpers — base unit = PIECE
 * Product pack config: unitsPerCarton (pcs/ctn), boxesPerCarton (box/ctn), pcsPerBox (pcs/box)
 * boxesPerCarton = 0 -> box level nahi (sirf ctn + loose pcs)
 */

export function splitPcs(pcs: number, upc: number, pcsPerBox = 0): { ctn: number; box: number; pcs: number } {
  const u = Math.max(1, upc)
  const total = Math.max(0, Math.round(pcs || 0))
  const ctn = Math.floor(total / u)
  const rem = total % u
  if (pcsPerBox > 0) return { ctn, box: Math.floor(rem / pcsPerBox), pcs: rem % pcsPerBox }
  return { ctn, box: 0, pcs: rem }
}

/** "2 crtn + 1 box + 5 pcs" — zero parts skip, sab zero -> "0" */
export function fmtQty(pcs: number, upc: number, pcsPerBox = 0): string {
  const { ctn, box, pcs: pcsPart } = splitPcs(pcs, upc, pcsPerBox)
  if (ctn === 0 && box === 0 && pcsPart === 0) return '0'
  const parts: string[] = []
  if (ctn > 0) parts.push(`${ctn} crtn`)
  if (box > 0) parts.push(`${box} box`)
  if (pcsPart > 0) parts.push(`${pcsPart} pcs`)
  return parts.join(' + ')
}

/** "1 Ctn = 2 Box = 12 Pcs" ya "1 Ctn = 24 Pcs" */
export function packHint(upc: number, boxesPerCarton = 0, pcsPerBox = 0): string {
  if (boxesPerCarton > 0 && pcsPerBox > 0) return `1 Ctn = ${boxesPerCarton} Box = ${upc} Pcs`
  return `1 Ctn = ${upc} Pcs`
}

import { Input } from '@/components/ui/input'

/**
 * Compact 3-input qty entry (Ctn / Box / Pcs). Value internally total PIECES.
 * Box input sirf tab dikhta hai jab product ka box level ho (pcsPerBox > 0).
 */
export function UnitQtyInputs({ pcs, upc, pcsPerBox = 0, onChange, maxPcs, inputW = 'w-14' }: {
  pcs: number
  upc: number
  pcsPerBox?: number
  onChange: (totalPcs: number) => void
  maxPcs?: number
  inputW?: string
}) {
  const s = splitPcs(pcs, upc, pcsPerBox)
  const boxStep = pcsPerBox > 0 ? pcsPerBox : 0

  function commit(ctn: number, box: number, pcsPart: number) {
    const total = ctn * Math.max(1, upc) + box * boxStep + pcsPart
    const clamped = Math.max(0, Math.floor(total))
    onChange(maxPcs != null ? Math.min(clamped, maxPcs) : clamped)
  }

  const cell = 'flex flex-col items-center gap-0.5'
  const lbl = 'text-[9px] leading-none text-slate-400 font-medium'

  return (
    <div className="flex items-start gap-1.5">
      <div className={cell}>
        <Input
          type="number" min={0} inputMode="numeric"
          className={`h-9 text-center ${inputW}`}
          value={s.ctn === 0 ? '' : String(s.ctn)}
          placeholder="0"
          onChange={(e) => commit(Math.max(0, Math.floor(Number(e.target.value) || 0)), s.box, s.pcs)}
        />
        <span className={lbl}>Ctn</span>
      </div>
      {boxStep > 0 && (
        <div className={cell}>
          <Input
            type="number" min={0} inputMode="numeric"
            className={`h-9 text-center ${inputW}`}
            value={s.box === 0 ? '' : String(s.box)}
            placeholder="0"
            onChange={(e) => commit(s.ctn, Math.max(0, Math.floor(Number(e.target.value) || 0)), s.pcs)}
          />
          <span className={lbl}>Box</span>
        </div>
      )}
      <div className={cell}>
        <Input
          type="number" min={0} inputMode="numeric"
          className={`h-9 text-center ${inputW}`}
          value={s.pcs === 0 ? '' : String(s.pcs)}
          placeholder="0"
          onChange={(e) => commit(s.ctn, s.box, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
        <span className={lbl}>Pcs</span>
      </div>
    </div>
  )
}
