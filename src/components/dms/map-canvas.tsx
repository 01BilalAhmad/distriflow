'use client'

/**
 * Task 36 — MapCanvas: react-leaflet (OpenStreetMap tiles, no API key) inner component.
 * Parent (visit-map.tsx) ise dynamic(() => import, { ssr: false }) se load karta hai
 * kyunki Leaflet window object maangta hai.
 *
 * - Har visit = CircleMarker (color by status) + tooltip (dukaan, code, time)
 * - Routes: per-salesman polyline of CHECKED_IN/COMPLETED visits (checkIn time order)
 * - FitBounds jab points change hon; empty ho to Pakistan center default
 */

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  status: string // PENDING | CHECKED_IN | COMPLETED | MISSED
  name: string
  code: string
  channel: string
  checkInAt: string | null
  sequence: number
  salesmanName: string
}

export interface MapRoute {
  salesmanId: string
  coords: [number, number][]
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#94a3b8', // slate
  CHECKED_IN: '#f59e0b', // amber — abhi dukaan par
  COMPLETED: '#10b981', // emerald — visit mukammal
  MISSED: '#ef4444', // red
}

const ROUTE_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#db2777', '#4f46e5']

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) {
      map.setView([30.3753, 69.3451], 5) // Pakistan center
      return
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15)
      return
    }
    const lats = points.map((p) => p.lat)
    const lngs = points.map((p) => p.lng)
    // setBounds ko map.fitBounds se pehle invalidateSize ke sath use karo — container render timing
    map.invalidateSize()
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [45, 45], maxZoom: 16 },
    )
  }, [map, points])
  return null
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function MapCanvas({ points, routes }: { points: MapPoint[]; routes: MapRoute[] }) {
  return (
    <MapContainer
      center={[30.3753, 69.3451]}
      zoom={5}
      className="h-full w-full rounded-xl z-0"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />

      {routes.map((r, i) => (
        <Polyline
          key={`route-${r.salesmanId}`}
          positions={r.coords}
          pathOptions={{ color: ROUTE_COLORS[i % ROUTE_COLORS.length], weight: 3, opacity: 0.65, dashArray: '6 6' }}
        />
      ))}

      {points.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={p.status === 'PENDING' ? 6 : 8}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: STATUS_COLOR[p.status] ?? '#94a3b8',
            fillOpacity: 0.92,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <div className="text-xs leading-snug">
              <div className="font-bold">{p.name}</div>
              <div className="text-slate-500">{p.code} &middot; {p.channel}</div>
              <div>
                <span
                  className="inline-block h-2 w-2 rounded-full mr-1 align-middle"
                  style={{ background: STATUS_COLOR[p.status] ?? '#94a3b8' }}
                />
                {p.status.replace('_', ' ')}
                {p.checkInAt ? ` — ${fmtTime(p.checkInAt)}` : ''}
              </div>
              <div className="text-slate-400">{p.salesmanName}</div>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

export default MapCanvas
