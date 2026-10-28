/**
 * DMS Seed Script - Pakistani FMCG Demo Data
 * Run: bun prisma/seed.ts  (ya: npx tsx prisma/seed.ts)
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

// deterministic pseudo-random
let seedState = 42
function rnd() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648
  return seedState / 2147483648
}
function ri(min: number, max: number) {
  return Math.floor(rnd() * (max - min + 1)) + min
}
function pick<T>(arr: T[]): T {
  return arr[ri(0, arr.length - 1)]
}

function daysAgo(n: number, hour = 10): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, ri(0, 59), 0, 0)
  return d
}
function today(hour: number, minute = 0): Date {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d
}
function daysAhead(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}
function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function main() {
  console.log('Clearing existing data...')
  await db.$transaction([
    db.returnItem.deleteMany(),
    db.saleReturn.deleteMany(),
    db.summarySettlement.deleteMany(),
    db.deliveryItem.deleteMany(),
    db.delivery.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),
    db.deliverySummary.deleteMany(),
    db.outletLedger.deleteMany(),
    db.recovery.deleteMany(),
    db.visit.deleteMany(),
    db.pJPPlan.deleteMany(),
    db.collection.deleteMany(),
    db.claim.deleteMany(),
    db.stockAdjustment.deleteMany(),
    db.stockBatch.deleteMany(),
    db.warehouse.deleteMany(),
    db.scheme.deleteMany(),
    db.outlet.deleteMany(),
    db.salesTarget.deleteMany(),
    db.distributorProfile.deleteMany(),
    db.purchaseInvoiceItem.deleteMany(),
    db.purchaseInvoice.deleteMany(),
    db.companyLedgerEntry.deleteMany(),
    db.company.deleteMany(),
    db.product.deleteMany(),
    db.brand.deleteMany(),
    db.appSetting.deleteMany(),
    db.user.deleteMany(),
  ])

  // ============ USERS ============
  // MEGA ADMIN (software seller) — sirf distributor accounts manage karta hai
  // (banata hai, active/inactive karta hai, monthly subscription renew karta hai).
  // Business data (orders/shops/recovery) ka usay koi access NAHI hai.
  console.log('Creating users...')
  // Task 95: bcrypt hashes — demo123 sab demo accounts ka password (hash DB mein jata hai)
  const demoHash = await bcrypt.hash('demo123', 10)
  await db.user.create({
    data: { name: 'Mega Admin (Software Seller)', email: 'admin@dms.pk', role: 'MEGA_ADMIN', phone: '+92 300 1234567', region: 'National', password: demoHash },
  })

  const distUser = await db.user.create({
    data: {
      name: 'Al-Madina Distribution', email: 'distributor@dms.pk', role: 'DISTRIBUTOR', phone: '+92 321 7654321', region: 'Lahore',
      isActive: true, subscriptionStart: new Date(), subscriptionExpiry: daysAhead(30), password: demoHash,
    },
  })
  const distProfile = await db.distributorProfile.create({
    data: { userId: distUser.id, businessName: 'Al-Madina Distribution', city: 'Lahore', region: 'Central Punjab', creditLimit: 2000000, tier: 'PRIMARY' },
  })

  // Sirf 2-tier model (Task 22b): MEGA_ADMIN -> DISTRIBUTOR -> ORDER BOOKERS (SALESMAN).
  // Sub-distributor level system se khatam — distributor ke sari network khud ke bookers hain.

  const salesmanData = [
    { name: 'Ali Raza', email: 'salesman@dms.pk', phone: '+92 301 1112223' },
    { name: 'Usman Khan', email: 'usman@dms.pk', phone: '+92 302 4445556' },
    { name: 'Bilal Ahmed', email: 'bilal@dms.pk', phone: '+92 303 7778889' },
  ]
  const salesmen: Array<{ id: string; name: string }> = []
  for (const s of salesmanData) {
    const u = await db.user.create({
      data: { name: s.name, email: s.email, role: 'SALESMAN', phone: s.phone, region: 'Lahore', parentId: distUser.id, password: demoHash },
    })
    salesmen.push(u)
  }

  // ============ BRANDS & PRODUCTS ============
  console.log('Creating catalog...')
  const brands = ['Tapal', 'Coca-Cola', 'Nestle', 'PepsiCo', 'English Biscuit', 'Unilever']
  const brandMap: Record<string, string> = {}
  for (const b of brands) {
    // Task 23: brands per-tenant — demo catalog Al-Madina ke naam par (private)
    const brand = await db.brand.create({ data: { name: b, distributorId: distProfile.id } })
    brandMap[b] = brand.id
  }

  const productDefs = [
    { sku: 'TP-DND-450', name: 'Tapal Danedar Tea 450g', brand: 'Tapal', category: 'Tea', unitsPerCarton: 24, tradePrice: 14400, consumerPrice: 600 },
    { sku: 'TP-FML-950', name: 'Tapal Family Mixture 950g', brand: 'Tapal', category: 'Tea', unitsPerCarton: 12, tradePrice: 10200, consumerPrice: 850 },
    { sku: 'CC-COK-150', name: 'Coca-Cola 1.5L PET', brand: 'Coca-Cola', category: 'Beverages', unitsPerCarton: 12, tradePrice: 3000, consumerPrice: 250 },
    { sku: 'CC-SPR-150', name: 'Sprite 1.5L PET', brand: 'Coca-Cola', category: 'Beverages', unitsPerCarton: 12, tradePrice: 3000, consumerPrice: 250 },
    { sku: 'CC-KIN-150', name: 'Kinley Water 1.5L', brand: 'Coca-Cola', category: 'Beverages', unitsPerCarton: 12, tradePrice: 960, consumerPrice: 80 },
    { sku: 'NF-MIL-100', name: 'Nestle Milkpak 1L', brand: 'Nestle', category: 'Dairy', unitsPerCarton: 12, tradePrice: 2640, consumerPrice: 220 },
    { sku: 'NF-FRV-200', name: 'Fruita Vitals Chaunsa 200ml', brand: 'Nestle', category: 'Beverages', unitsPerCarton: 30, tradePrice: 3600, consumerPrice: 120 },
    { sku: 'NF-NDO-080', name: 'Nido Fortified 800g', brand: 'Nestle', category: 'Dairy', unitsPerCarton: 12, tradePrice: 34800, consumerPrice: 2900 },
    { sku: 'PS-LAY-030', name: "Lays Masala 30g", brand: 'PepsiCo', category: 'Snacks', unitsPerCarton: 60, tradePrice: 3600, consumerPrice: 60 },
    { sku: 'PS-KRK-030', name: 'Kurkure Masala Munch 30g', brand: 'PepsiCo', category: 'Snacks', unitsPerCarton: 60, tradePrice: 3300, consumerPrice: 55 },
    { sku: 'PS-STG-050', name: 'Sting Energy 500ml', brand: 'PepsiCo', category: 'Beverages', unitsPerCarton: 24, tradePrice: 4800, consumerPrice: 200 },
    { sku: 'EB-SOP-065', name: 'Peek Freans Sooper 65g', brand: 'English Biscuit', category: 'Snacks', unitsPerCarton: 48, tradePrice: 8160, consumerPrice: 170 },
    { sku: 'EB-GLA-025', name: 'Gala Biscuit Roll 25g', brand: 'English Biscuit', category: 'Snacks', unitsPerCarton: 72, tradePrice: 5040, consumerPrice: 70 },
    { sku: 'UL-SRF-100', name: 'Surf Excel 1kg', brand: 'Unilever', category: 'Home Care', unitsPerCarton: 12, tradePrice: 19200, consumerPrice: 1600 },
    { sku: 'UL-LIF-115', name: 'Lifebuoy Soap 115g', brand: 'Unilever', category: 'Personal Care', unitsPerCarton: 72, tradePrice: 12960, consumerPrice: 180 },
    { sku: 'UL-VIM-200', name: 'Vim Bar 200g', brand: 'Unilever', category: 'Home Care', unitsPerCarton: 48, tradePrice: 7680, consumerPrice: 160 },
  ]
  // box-level heuristic (same as migration): common pack sizes, kam az kam 2 boxes/ctn
  const PACKS = [24, 12, 10, 8, 6, 5, 4, 3, 2]
  function boxLevel(u: number) {
    for (const d of PACKS) if (u % d === 0 && u / d >= 2) return { boxesPerCarton: u / d, pcsPerBox: d }
    return { boxesPerCarton: 0, pcsPerBox: 0 }
  }
  const products: Array<{ id: string; sku: string; name: string; unitsPerCarton: number; tradePrice: number; companyId: string | null; category: string }> = []
  for (const p of productDefs) {
    const prod = await db.product.create({
      data: {
        sku: p.sku, name: p.name, brandId: brandMap[p.brand], category: p.category,
        distributorId: distProfile.id,
        unit: 'CARTON', unitsPerCarton: p.unitsPerCarton, ...boxLevel(p.unitsPerCarton),
        tradePrice: p.tradePrice, consumerPrice: p.consumerPrice,
        // Task 86: distributor margin demo — purchase ~88-93% of trade (deterministic, SKU index par)
        purchasePrice: Math.round(p.tradePrice * (0.88 + ((p.tradePrice % 6) / 100))),
      },
    })
    products.push(prod)
  }

  // ============ COMPANIES (PROCUREMENT SUPPLIERS) ============
  // Task 24: har brand ka supplier company — products company se linked (purchase invoices isi liye).
  // Ye companies bhi per-tenant hain (distributorId = distProfile) — naya distributor khali account
  // paida hota hai aur apni supplier companies khud banata hai.
  console.log('Creating supplier companies...')
  const companyDefs = [
    { name: 'Tapal Private Limited', shortCode: 'TAP', brand: 'Tapal', contact: 'Imran Sheikh', phone: '+92 42 111 827 251', email: 'orders@tapal.com.pk', address: '6-A Gulberg III, Lahore' },
    { name: 'Coca-Cola Beverages Pakistan', shortCode: 'CCBP', brand: 'Coca-Cola', contact: 'Faisal Mahmood', phone: '+92 42 111 262 262', email: 'distributorcare@coca-cola.com.pk', address: 'Sundar Industrial Estate, Lahore' },
    { name: 'Nestlé Pakistan Limited', shortCode: 'NEST', brand: 'Nestle', contact: 'Ayesha Tariq', phone: '+92 42 111 637 853', email: 'orders@pk.nestle.com', address: 'Sheikhupura Road, Lahore' },
    { name: 'PepsiCo Pakistan', shortCode: 'PEPSI', brand: 'PepsiCo', contact: 'Kamran Butt', phone: '+92 42 3577 4200', email: 'orders@pepsico.com.pk', address: 'Ravi Road, Lahore' },
    { name: 'English Biscuit Manufacturers', shortCode: 'EBM', brand: 'English Biscuit', contact: 'Salman Ahmed', phone: '+92 21 111 326 326', email: 'sales@ebm.com.pk', address: 'Korangi Creek, Karachi' },
    { name: 'Unilever Pakistan Limited', shortCode: 'UNI', brand: 'Unilever', contact: 'Hina Qureshi', phone: '+92 21 111 864 538', email: 'orders.distributor@unilever.com', address: 'Estate Avenue, Karachi' },
  ]
  for (const c of companyDefs) {
    const company = await db.company.create({
      data: {
        name: c.name, shortCode: c.shortCode, contactPerson: c.contact, phone: c.phone,
        email: c.email, address: c.address, distributorId: distProfile.id,
      },
    })
    // isi brand ke products ko company se link (procurement/invoicing ke liye)
    await db.product.updateMany({
      where: { brandId: brandMap[c.brand], distributorId: distProfile.id },
      data: { companyId: company.id },
    })
  }

  // ============ WAREHOUSES ============
  console.log('Creating warehouses & stock...')
  const mainWh = await db.warehouse.create({
    data: { name: 'Al-Madina Main Warehouse', distributorId: distProfile.id, city: 'Lahore', isPrimary: true },
  })
  const subWh = await db.warehouse.create({
    data: { name: 'Model Town Godown', distributorId: distProfile.id, city: 'Lahore', isPrimary: false },
  })

  // stock batches with FEFO-relevant expiry dates — qty PIECES base (cartons × unitsPerCarton)
  const batchCounter = { n: 1000 }
  for (const p of products) {
    const batches = ri(1, 2)
    for (let i = 0; i < batches; i++) {
      batchCounter.n += 7
      const expOffset = i === 0 ? ri(20, 45) : ri(120, 400) // first batch closer to expiry for FEFO demo
      await db.stockBatch.create({
        data: {
          warehouseId: mainWh.id, productId: p.id, batchNo: `B${batchCounter.n}`,
          qty: ri(40, 260) * p.unitsPerCarton, mfgDate: daysAgo(ri(30, 150)), expDate: daysAhead(expOffset), receivedAt: daysAgo(ri(5, 60)),
        },
      })
    }
    batchCounter.n += 3
    await db.stockBatch.create({
      data: {
        warehouseId: subWh.id, productId: p.id, batchNo: `B${batchCounter.n}`,
        qty: ri(10, 90) * p.unitsPerCarton, mfgDate: daysAgo(ri(10, 80)), expDate: daysAhead(ri(60, 350)), receivedAt: daysAgo(ri(3, 30)),
      },
    })
  }

  // ============ OUTLETS ============
  console.log('Creating outlets...')
  const outletDefs = [
    { name: 'Barkat Kiryana Store', owner: 'Haji Sahib', channel: 'KIRYANA', area: 'Moon Market, Allama Iqbal Town', lat: 31.4671, lng: 74.2641, dist: 'main', sm: 0 },
    { name: 'Al-Fatah Super Market', owner: 'Chaudhry sb', channel: 'SUPERMARKET', area: 'Johar Town', lat: 31.4697, lng: 74.2728, dist: 'main', sm: 0 },
    { name: 'Madina Cash & Carry', owner: 'Rana Waseem', channel: 'WHOLESALE', area: 'Shadman', lat: 31.5337, lng: 74.3047, dist: 'main', sm: 1 },
    { name: 'Chandni Chowk Store', owner: 'Imran Bhai', channel: 'KIRYANA', area: 'Gulberg III', lat: 31.5214, lng: 74.3467, dist: 'main', sm: 1 },
    { name: 'Fresh Point Grocers', owner: 'Zubair Ahmad', channel: 'GENERAL', area: 'Model Town', lat: 31.4818, lng: 74.3129, dist: 'sub', sm: 2 },
    { name: 'Shezan Restaurant Suppliers', owner: 'Nadeem sb', channel: 'WHOLESALE', area: 'Ferozepur Road', lat: 31.5103, lng: 74.3089, dist: 'sub', sm: 2 },
    { name: 'Metro Habib Cash & Carry', owner: 'Metro Mgmt', channel: 'SUPERMARKET', area: 'Ring Road', lat: 31.4977, lng: 74.3624, dist: 'main', sm: 0 },
    { name: 'Iqbal Kiryana Center', owner: 'Tanveer Iqbal', channel: 'KIRYANA', area: 'Township', lat: 31.4387, lng: 74.3028, dist: 'sub', sm: 2 },
    { name: 'Green Valley Stores', owner: 'Farhan Munir', channel: 'GENERAL', area: 'DHA Phase 4', lat: 31.4805, lng: 74.3937, dist: 'main', sm: 1 },
    { name: 'Anwar Bhai Pan Shop', owner: 'Anwar Ali', channel: 'KIRYANA', area: 'Wapda Town', lat: 31.4511, lng: 74.2642, dist: 'main', sm: 0 },
    { name: 'Bismillah General Store', owner: 'Rafiq jr', channel: 'GENERAL', area: 'Samanabad', lat: 31.5364, lng: 74.2741, dist: 'main', sm: 1 },
    { name: 'Grand Smokers & Grocers', owner: 'Kamran Akmal', channel: 'SUPERMARKET', area: 'Cantt', lat: 31.5204, lng: 74.3515, dist: 'sub', sm: 2 },
  ]
  const outlets: Array<{ id: string; code: string; code4: string | null; name: string; channel: string; salesmanId: string | null; distributorId: string; lat: number | null; lng: number | null }> = []
  let outCode = 1000
  let outCode4 = 1000
  for (const o of outletDefs) {
    outCode += 5
    outCode4 += 1
    const outlet = await db.outlet.create({
      data: {
        code: `OUT-${outCode}`, code4: String(outCode4), name: o.name, ownerName: o.owner, phone: `+92 3${ri(0, 4)}${ri(0, 9)} ${ri(1000000, 9999999)}`,
        address: o.area + ', Lahore', city: 'Lahore', channel: o.channel, lat: o.lat, lng: o.lng,
        creditDays: o.channel === 'WHOLESALE' ? 15 : 7,
        distributorId: distProfile.id,
        salesmanId: salesmen[o.sm].id,
      },
    })
    outlets.push(outlet)
  }

  // ============ SCHEMES ============
  console.log('Creating schemes...')
  const coke = products.find((p) => p.sku === 'CC-COK-150')!
  const tapal = products.find((p) => p.sku === 'TP-DND-450')!
  const lays = products.find((p) => p.sku === 'PS-LAY-030')!
  await db.scheme.create({
    data: { distributorId: distProfile.id, name: 'Coke Summer Bundle 5+1', description: 'Buy 5 cartons, get 1 carton free', type: 'BUY_X_GET_Y', productId: coke.id, value: 0, buyQty: 5, freeQty: 1, startDate: daysAgo(10), endDate: daysAhead(50) },
  })
  await db.scheme.create({
    data: { distributorId: distProfile.id, name: 'Kiriyana Discount 5%', description: 'All Kiryana channel outlets get 5% off', type: 'PERCENT_DISCOUNT', channel: 'KIRYANA', value: 5, startDate: daysAgo(30), endDate: daysAhead(60) },
  })
  await db.scheme.create({
    data: { distributorId: distProfile.id, name: 'Tapal Carton Flat Rs.300 Off', description: 'Flat Rs.300 off per carton of Tapal Danedar', type: 'FLAT_DISCOUNT', productId: tapal.id, value: 300, startDate: daysAgo(5), endDate: daysAhead(25) },
  })
  await db.scheme.create({
    data: { distributorId: distProfile.id, name: 'Lays Counter Display 3+1', description: 'Buy 3 cartons Lays, get 1 free', type: 'BUY_X_GET_Y', productId: lays.id, value: 0, buyQty: 3, freeQty: 1, startDate: daysAgo(15), endDate: daysAhead(15) },
  })
  await db.scheme.create({
    data: { distributorId: distProfile.id, name: 'Wholesale Volume 3%', description: '3% discount on all wholesale channel orders', type: 'PERCENT_DISCOUNT', channel: 'WHOLESALE', value: 3, startDate: daysAgo(60), endDate: daysAhead(90), isActive: true },
  })
  const schemes = await db.scheme.findMany()

  // ============ ORDERS (past 14 days) ============
  console.log('Creating order history...')
  let orderCounter = 5000
  let deliveredCount = 0
  for (let day = 14; day >= 0; day--) {
    const ordersToday = day === 0 ? 2 : ri(1, 3)
    for (let i = 0; i < ordersToday; i++) {
      orderCounter += 3
      const outlet = pick(outlets)
      const salesman = salesmen.find((s) => s.id === outlet.salesmanId)!
      const itemCount = ri(2, 5)
      const chosen = [...products].sort(() => rnd() - 0.5).slice(0, itemCount)
      let subtotal = 0
      let schemeDiscount = 0
      const itemsData: { productId: string; qty: number; freeQty: number; rate: number; discount: number; schemeId: string | null; lineTotal: number }[] = []

      for (const p of chosen) {
        const qtyCtn = ri(2, 12)
        const qty = qtyCtn * p.unitsPerCarton // PIECES base
        const rate = p.tradePrice / p.unitsPerCarton // per PIECE
        let freeQty = 0
        let discount = 0
        let schemeId: string | null = null

        // auto-apply schemes (same logic as API — schemes carton-based hain)
        const applicable = schemes.filter(
          (s) => s.isActive && (!s.productId || s.productId === p.id) && (!s.channel || s.channel === outlet.channel)
        )
        for (const s of applicable) {
          if (s.type === 'BUY_X_GET_Y' && s.buyQty > 0 && qtyCtn >= s.buyQty) {
            freeQty = Math.floor(qtyCtn / s.buyQty) * s.freeQty * p.unitsPerCarton
            schemeId = s.id
          } else if (s.type === 'PERCENT_DISCOUNT') {
            discount += Math.round((rate * qty * s.value) / 100)
            schemeId = s.id
          } else if (s.type === 'FLAT_DISCOUNT') {
            discount += s.value * qtyCtn
            schemeId = s.id
          }
        }
        const lineTotal = Math.round(rate * qty * 100) / 100 - discount
        subtotal += Math.round(rate * qty * 100) / 100
        schemeDiscount += discount
        itemsData.push({ productId: p.id, qty, freeQty, rate, discount, schemeId, lineTotal })
      }

      const total = subtotal - schemeDiscount
      const status = day === 0 ? 'CONFIRMED' : day <= 2 ? pick(['CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED']) : 'DELIVERED'
      if (status === 'DELIVERED') deliveredCount++

      await db.order.create({
        data: {
          orderNo: `ORD-${orderCounter}`,
          outletId: outlet.id, salesmanId: salesman.id,
          distributorId: outlet.distributorId, channel: outlet.channel,
          status, subtotal, schemeDiscount, total,
          orderDate: daysAgo(day, ri(9, 17)),
          items: { create: itemsData },
        },
      })
    }
  }

  // ============ PJP (today + yesterday) ============
  console.log('Creating PJP plans...')
  const sm0Outlets = outlets.filter((o) => o.salesmanId === salesmen[0].id)
  const sm1Outlets = outlets.filter((o) => o.salesmanId === salesmen[1].id)

  const planToday = await db.pJPPlan.create({
    data: { salesmanId: salesmen[0].id, date: today(0), status: 'IN_PROGRESS' },
  })
  let seq = 1
  for (const o of sm0Outlets) {
    await db.visit.create({
      data: { planId: planToday.id, outletId: o.id, sequence: seq++, status: 'PENDING' },
    })
  }
  const visitsToday = await db.visit.findMany({ where: { planId: planToday.id }, orderBy: { sequence: 'asc' } })
  if (visitsToday.length > 0) {
    await db.visit.update({
      where: { id: visitsToday[0].id },
      data: { status: 'COMPLETED', checkInAt: today(9, 15), checkOutAt: today(9, 42), checkInLat: (visitsToday as never as { outlet?: { lat?: number } }) ? undefined : undefined, notes: 'Order booked - Coke 5+1 scheme pitch' },
    })
    await db.visit.update({
      where: { id: visitsToday[1].id },
      data: { status: 'CHECKED_IN', checkInAt: today(10, 5), checkInLat: 31.4699, checkInLng: 74.2730 },
    })
  }

  const planTodayU = await db.pJPPlan.create({
    data: { salesmanId: salesmen[1].id, date: today(0), status: 'PLANNED' },
  })
  seq = 1
  for (const o of sm1Outlets) {
    await db.visit.create({ data: { planId: planTodayU.id, outletId: o.id, sequence: seq++, status: 'PENDING' } })
  }

  const planYest = await db.pJPPlan.create({
    data: { salesmanId: salesmen[0].id, date: daysAgo(1), status: 'COMPLETED' },
  })
  seq = 1
  for (const o of sm0Outlets) {
    await db.visit.create({
      data: {
        planId: planYest.id, outletId: o.id, sequence: seq++, status: 'COMPLETED',
        checkInAt: daysAgo(1, 9 + seq), checkOutAt: daysAgo(1, 9 + seq), checkInLat: o.lat, checkInLng: o.lng,
      },
    })
  }

  // ============ RETURNS ============
  console.log('Creating returns & claims...')
  const r1 = outlets[0], r2 = outlets[3]
  const layP = lays, ccP = coke
  // PIECES base: qty = cartons × U, rate per pc
  const ret1Value = layP.tradePrice * 2 + ccP.tradePrice * 1
  await db.saleReturn.create({
    data: {
      returnNo: 'RET-1001', outletId: r1.id, type: 'DAMAGED', status: 'APPROVED', totalValue: ret1Value,
      reason: 'Cartons crushed during transport', createdAt: daysAgo(4),
      items: {
        create: [
          { productId: layP.id, qty: 2 * layP.unitsPerCarton, rate: layP.tradePrice / layP.unitsPerCarton, value: layP.tradePrice * 2 },
          { productId: ccP.id, qty: 1 * ccP.unitsPerCarton, rate: ccP.tradePrice / ccP.unitsPerCarton, value: ccP.tradePrice * 1 },
        ],
      },
    },
  })
  const milk = products.find((p) => p.sku === 'NF-MIL-100')!
  const ret2Value = milk.tradePrice * 3
  await db.saleReturn.create({
    data: {
      returnNo: 'RET-1002', outletId: r2.id, type: 'EXPIRED', status: 'PENDING', totalValue: ret2Value,
      reason: 'Milkpak expired on shelf', createdAt: daysAgo(1),
      items: { create: [{ productId: milk.id, qty: 3 * milk.unitsPerCarton, rate: milk.tradePrice / milk.unitsPerCarton, value: milk.tradePrice * 3 }] },
    },
  })

  // ============ CLAIMS ============
  await db.claim.create({
    data: { claimNo: 'CLM-2001', distributorId: distProfile.id, type: 'SCHEME_CLAIM', amount: 45000, status: 'PENDING', reason: 'Ramzan scheme settlement pending from company', createdAt: daysAgo(6) },
  })
  await db.claim.create({
    data: { claimNo: 'CLM-2002', distributorId: distProfile.id, type: 'DAMAGED', amount: 12800, status: 'APPROVED', approvedBy: 'Company Ops', reason: 'Transit damage claim - approved', createdAt: daysAgo(12) },
  })
  await db.claim.create({
    data: { claimNo: 'CLM-2003', distributorId: distProfile.id, type: 'RETURN_CLAIM', amount: ret2Value, status: 'PENDING', reason: 'Expired stock claim RET-1002', createdAt: daysAgo(1) },
  })

  // ============ COLLECTIONS ============
  let rcpt = 3000
  for (let i = 0; i < 18; i++) {
    rcpt += 7
    const outlet = pick(outlets)
    await db.collection.create({
      data: {
        receiptNo: `RCP-${rcpt}`, outletId: outlet.id,
        amount: ri(8, 95) * 1000, method: pick(['CASH', 'CASH', 'BANK', 'CHEQUE']),
        collectedById: outlet.salesmanId, date: daysAgo(ri(0, 13), ri(10, 18)),
      },
    })
  }

  // ============ TARGETS ============
  console.log('Creating targets...')
  const targetDefs = [
    { s: 0, value: 1500000 }, { s: 1, value: 1200000 }, { s: 2, value: 900000 },
  ]
  for (const t of targetDefs) {
    await db.salesTarget.create({
      data: { salesmanId: salesmen[t.s].id, month: monthKey(), targetValue: t.value },
    })
  }

  // ============ STOCK ADJUSTMENTS (sample) — PIECES base ============
  await db.stockAdjustment.create({
    data: { warehouseId: mainWh.id, productId: products[0].id, type: 'OUT', qty: 5 * products[0].unitsPerCarton, reason: 'Damage - water leakage in godown', userId: distUser.id, createdAt: daysAgo(3) },
  })
  await db.stockAdjustment.create({
    data: { warehouseId: mainWh.id, productId: products[5].id, type: 'IN', qty: 20 * products[5].unitsPerCarton, reason: 'Physical count surplus reconciliation', userId: distUser.id, createdAt: daysAgo(8) },
  })

  const counts = {
    users: await db.user.count(),
    products: await db.product.count(),
    outlets: await db.outlet.count(),
    orders: await db.order.count(),
    schemes: await db.scheme.count(),
    visits: await db.visit.count(),
  }
  console.log('Seed complete!', counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
