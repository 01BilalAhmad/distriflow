'use client'

/**
 * Recovery print documents (CBL-style A4, PrintFrame ke sath use hote hain):
 *  1. RecoveryRouteSheetDoc — booker apne route ki shops ki pending-udhaar sheet
 *     print karta hai (Wasooli/Receipt columns khali — route par hath se bhar jati hain)
 *  2. RecoveryReportDoc     — orderbooker-wise recovery report (summary + voucher history)
 */

import { PrintFrame } from '@/components/dms/cbl-print'
import { DAY_FULL } from '@/lib/dms-day'
import type { RecoveryBookerDTO, RecoveryRowDTO, RecoveryShopDTO } from '@/lib/dms-types'

const fmt2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const printDate = () => {
  const d = new Date()
  const date = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return `${date} ${time}`
}
const dayDate = (d: string | Date) => {
  const dt = new Date(d)
  return `${dt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })} / ${dt.toLocaleDateString('en-US', { weekday: 'long' })}`
}
const shortDate = (d: string | Date) => new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

function Signatures({ left, right }: { left: [string, string]; right: [string, string] }) {
  return (
    <div className="mt-auto flex justify-between px-6 pt-10">
      {[left, right].map((s, i) => (
        <div key={i} className="w-48 text-center cbl-break-avoid">
          <p className="mb-1 text-[11px]">{s[0]}</p>
          <div style={{ border: '1.5px solid #000' }} className="px-3 py-1.5 text-[11px] font-bold">{s[1]}</div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// 1) RECOVERY ROUTE SHEET — booker ke route ki pending shops
//    Task 99: day-wise — "Visit Day" select ho to sirf usi din ki visit shops
//    print hoti hain (roz wali shops har din shamil), owner/phone + Sign column
//    + khali rows — booker route par hath se bharta hai.
// ============================================================
export function RecoveryRouteSheetDoc({ businessName, bookerName, bookerPhone, date, day, shops }: {
  businessName: string
  bookerName: string
  bookerPhone?: string | null
  date: string
  /** 'ALL' ya day code (MON..SUN) — undefined = ALL */
  day?: string
  shops: RecoveryShopDTO[]
}) {
  const pending = shops.filter((s) => s.balance > 0.005)
  const total = pending.reduce((a, s) => a + s.balance, 0)
  const dayName = day && day !== 'ALL' ? DAY_FULL[day] ?? null : null
  const blankRows = 4

  return (
    <div className="cbl-doc">
      <div className="cbl-page bg-white px-8 py-7 flex flex-col">
        {/* header: distributor (left) + meta (right) */}
        <div className="flex justify-between">
          <div style={{ width: '58%' }}>
            <p className="text-[17px] font-bold underline">{businessName}</p>
            <table style={{ border: 'none', marginTop: 4 }}>
              <tbody>
                <tr><td style={{ border: 'none', width: 105, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Order Booker:</td><td style={{ border: 'none' }}>{bookerName}{bookerPhone ? ` — ${bookerPhone}` : ''}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Visit Day:</td><td style={{ border: 'none', fontWeight: 'bold' }}>{dayName ? dayName.toUpperCase() : 'TAMAM DIN (SARI SHOPS)'}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Route Shops:</td><td style={{ border: 'none' }}>{pending.length} shops — jinka udhaar baqi hai</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '40%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 105, whiteSpace: 'nowrap', paddingRight: 8 }}>Sheet Date :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(date)}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Print Date :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{printDate()}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[16px] font-bold">RECOVERY ROUTE SHEET</p>
            <p className="text-[10px] font-bold" style={{ letterSpacing: 0.5 }}>UDHAAR WASOOLI — {dayName ? `${dayName.toUpperCase()} KI SHOPS` : 'SHOP WISE PENDING LIST'}</p>
          </div>
        </div>

        {/* shops table — Wasooli/Receipt#/Sign columns KHALI hain (booker route par likhe ga) */}
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase" style={{ letterSpacing: 0.5 }}>Shop Wise Pending Udhaar</p>
        <table style={{ fontSize: 9 }}>
          <colgroup>
            <col style={{ width: '5%' }} /><col style={{ width: '10%' }} /><col style={{ width: '25%' }} />
            <col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} /><col style={{ width: '10%' }} /><col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>S.No#</th>
              <th>Shop Code</th>
              <th style={{ textAlign: 'left' }}>Shop Name / Owner</th>
              <th>City</th>
              <th>Channel</th>
              <th>Pending Udhaar</th>
              <th>Wasooli (Rs)</th>
              <th>Receipt #</th>
              <th>Sign</th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'left' }}>{dayName ? `${dayName} ko is route ki koi pending udhaar shop nahi — sab settled hain.` : 'Is booker ke route mein koi pending udhaar nahi — sab shops settled hain.'}</td></tr>
            ) : pending.map((s, i) => (
              <tr key={s.outletId} className="cbl-break-avoid">
                <td className="ctr">{i + 1}</td>
                <td className="ctr">{s.code}</td>
                <td style={{ textAlign: 'left' }}>
                  {s.name.toUpperCase()}
                  {(s.ownerName || s.phone) && (
                    <div style={{ fontSize: 7, color: '#444' }}>{[s.ownerName, s.phone].filter(Boolean).join(' — ')}</div>
                  )}
                </td>
                <td className="ctr">{s.city}</td>
                <td className="ctr" style={{ fontSize: 7.5, whiteSpace: 'nowrap' }}>{s.channel}</td>
                <td className="num">{fmt2(s.balance)}</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
            {/* Task 99: khali rows — agar kisi dusri shop se bhi wasooli ho to booker likh sake */}
            {pending.length > 0 && Array.from({ length: blankRows }).map((_, k) => (
              <tr key={`blank-${k}`} className="cbl-break-avoid">
                <td className="ctr" style={{ color: '#999' }}>{pending.length + k + 1}</td>
                <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
                <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td colSpan={5} style={{ textAlign: 'right' }}>Total Pending ({pending.length} shops)</td>
              <td className="num">{fmt2(total)}</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
            </tr>
          </tbody>
        </table>

        {/* note */}
        <div className="mt-4" style={{ width: '58%' }}>
          <table style={{ fontSize: 9.5 }}>
            <tbody>
              <tr><td style={{ border: 'none', fontWeight: 'bold' }}>Note:</td><td style={{ border: 'none', textAlign: 'left' }}>Booker ye sheet route par le jaye{dayName ? ` — is par sirf ${dayName} ki visit shops hain (jis shop ke visit days set nahi wo roz aati hai)` : ''}. Har shop se jo raqam wasool ho usi waqt &quot;Wasooli (Rs)&quot; column mein likhe, receipt # darj kare aur shop ke muhtamal se sign karwaye. Agar kisi dusri shop se bhi wasooli ho to neeche khali rows mein likhein. Shaam ko office mein ye wasooli Recovery page par post hogi, shop ledger usi waqt update ho jayega.</td></tr>
            </tbody>
          </table>
        </div>

        <Signatures left={[bookerName, 'Order Booker Signature']} right={['Admin / Distributor', 'Office Signature']} />
      </div>
    </div>
  )
}

// ============================================================
// 2) ORDERBOOKER WISE RECOVERY REPORT — summary + voucher history
// ============================================================
export function RecoveryReportDoc({ businessName, bookers, history }: {
  businessName: string
  bookers: RecoveryBookerDTO[]
  history: RecoveryRowDTO[]
}) {
  const T = {
    outstanding: bookers.reduce((a, b) => a + b.totalOutstanding, 0),
    today: bookers.reduce((a, b) => a + b.recoveredToday, 0),
    month: bookers.reduce((a, b) => a + b.recoveredMonth, 0),
    total: bookers.reduce((a, b) => a + b.recoveredTotal, 0),
  }

  return (
    <div className="cbl-doc">
      <div className="cbl-page bg-white px-8 py-7 flex flex-col">
        {/* header */}
        <div className="flex justify-between">
          <div style={{ width: '58%' }}>
            <p className="text-[17px] font-bold underline">{businessName}</p>
            <table style={{ border: 'none', marginTop: 4 }}>
              <tbody>
                <tr><td style={{ border: 'none', width: 105, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Bookers:</td><td style={{ border: 'none' }}>{bookers.filter((b) => b.id).length} order bookers</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Vouchers:</td><td style={{ border: 'none' }}>{history.length} recovery entries (latest)</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '40%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 105, whiteSpace: 'nowrap', paddingRight: 8 }}>Report Date :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(new Date())}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Print Date :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{printDate()}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[16px] font-bold">ORDERBOOKER WISE RECOVERY REPORT</p>
            <p className="text-[10px] font-bold" style={{ letterSpacing: 0.5 }}>UDHAAR WASOOLI — BOOKER PERFORMANCE &amp; VOUCHER HISTORY</p>
          </div>
        </div>

        {/* SECTION A: booker-wise summary */}
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase" style={{ letterSpacing: 0.5 }}>A) Booker Wise Recovery Muqabla</p>
        <table style={{ fontSize: 9 }}>
          <colgroup>
            <col style={{ width: '5%' }} /><col style={{ width: '20%' }} /><col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>S.No#</th>
              <th style={{ textAlign: 'left' }}>Order Booker</th>
              <th>Route Shops</th>
              <th>Udhaar Shops</th>
              <th>Pending Udhaar</th>
              <th>Recovered Today</th>
              <th>This Month</th>
              <th>Total Recovery</th>
              <th>Last Recovery</th>
            </tr>
          </thead>
          <tbody>
            {bookers.map((b, i) => (
              <tr key={b.id ?? 'none'} className="cbl-break-avoid">
                <td className="ctr">{i + 1}</td>
                <td style={{ textAlign: 'left' }}>{b.id ? b.name.toUpperCase() : 'UNASSIGNED SHOPS'}</td>
                <td className="ctr">{b.routeShops}</td>
                <td className="ctr">{b.shopsWithUdhaar}</td>
                <td className="num">{fmt2(b.totalOutstanding)}</td>
                <td className="num">{fmt2(b.recoveredToday)}</td>
                <td className="num">{fmt2(b.recoveredMonth)}</td>
                <td className="num">{fmt2(b.recoveredTotal)}</td>
                <td className="ctr" style={{ whiteSpace: 'nowrap' }}>{b.lastRecoveryAt ? shortDate(b.lastRecoveryAt) : '-'}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td colSpan={4} style={{ textAlign: 'right' }}>Total</td>
              <td className="num">{fmt2(T.outstanding)}</td>
              <td className="num">{fmt2(T.today)}</td>
              <td className="num">{fmt2(T.month)}</td>
              <td className="num">{fmt2(T.total)}</td>
              <td>-</td>
            </tr>
          </tbody>
        </table>

        {/* SECTION B: voucher history */}
        <p className="mb-1 mt-4 text-[11px] font-bold uppercase" style={{ letterSpacing: 0.5 }}>B) Recovery Voucher History (Latest {history.length})</p>
        <table style={{ fontSize: 8.5 }}>
          <colgroup>
            <col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '24%' }} /><col style={{ width: '8%' }} /><col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} /><col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>Voucher #</th>
              <th>Date</th>
              <th style={{ textAlign: 'left' }}>Order Booker</th>
              <th style={{ textAlign: 'left' }}>Shop</th>
              <th>Method</th>
              <th>Reference</th>
              <th>Amount</th>
              <th>Posted By</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'left' }}>Abhi koi recovery voucher post nahi hui.</td></tr>
            ) : history.map((r) => (
              <tr key={r.id} className="cbl-break-avoid">
                <td className="ctr">{r.recoveryNo}</td>
                <td className="ctr" style={{ whiteSpace: 'nowrap' }}>{shortDate(r.date)}</td>
                <td style={{ textAlign: 'left' }}>{r.bookerName}</td>
                <td style={{ textAlign: 'left' }}>{r.outletName.toUpperCase()} [ {r.outletCode} ]</td>
                <td className="ctr" style={{ fontSize: 7.5 }}>{r.method}</td>
                <td className="ctr">{r.reference ?? '-'}</td>
                <td className="num">{fmt2(r.amount)}</td>
                <td className="ctr">{r.postedByName ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Signatures left={['Recovery Checked By', 'Accountant Signature']} right={['Admin / Distributor', 'Approved Signature']} />
      </div>
    </div>
  )
}

/** PrintFrame wrapper — route sheet (Task 99: day-aware — pdfName mein din) */
export function RouteSheetPrint(props: Parameters<typeof RecoveryRouteSheetDoc>[0] & { onClose: () => void }) {
  const { onClose, ...doc } = props
  const dayName = doc.day && doc.day !== 'ALL' ? DAY_FULL[doc.day] ?? null : null
  return (
    <PrintFrame
      title={dayName ? `Recovery Route Sheet — ${dayName}` : 'Recovery Route Sheet'}
      onClose={onClose}
      pdfName={`recovery-sheet-${dayName ? `${doc.day!.toLowerCase()}-` : ''}${doc.bookerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <RecoveryRouteSheetDoc {...doc} />
    </PrintFrame>
  )
}

/** PrintFrame wrapper — recovery report */
export function RecoveryReportPrint(props: Parameters<typeof RecoveryReportDoc>[0] & { onClose: () => void }) {
  const { onClose, ...doc } = props
  return (
    <PrintFrame title="Orderbooker Recovery Report" onClose={onClose} pdfName="orderbooker-recovery-report">
      <RecoveryReportDoc {...doc} />
    </PrintFrame>
  )
}
