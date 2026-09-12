import type { Camera } from './api'

// Population/route logic for the 2D canvas traffic layer (TrafficSimulation.tsx)
// — a purely client-side "digital twin" visualization built on real
// camera/blacklist data, feeding the Dashboard's sidebar (stats card,
// tracking card).

export type VehicleKind = 'normal' | 'blacklisted' | 'suspicious'

export interface SimStats {
  active: number
  blacklisted: number
  suspicious: number
  detectionsThisSession: number
}

export interface SelectedVehicleInfo {
  id: number
  plate: string
  kind: VehicleKind
  fromCamera: string
  toCamera: string
  progressPct: number
}

const FAKE_PLATE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const FAKE_PLATE_STATES = ['DL', 'HR', 'UP', 'MH', 'KA', 'RJ']

export function randomPlate(): string {
  const state = FAKE_PLATE_STATES[Math.floor(Math.random() * FAKE_PLATE_STATES.length)]
  const num1 = Math.floor(Math.random() * 90) + 10
  const letters = Array.from({ length: 2 }, () => FAKE_PLATE_CHARS[Math.floor(Math.random() * FAKE_PLATE_CHARS.length)]).join('')
  const num2 = Math.floor(Math.random() * 9000) + 1000
  return `${state}${num1}${letters}${num2}`
}

export function pickRoute(cameras: Camera[], count: number): Camera[] {
  const shuffled = [...cameras].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, cameras.length))
}

// A vehicle that just finished its route keeps moving — start the next leg
// from wherever it is now rather than teleporting, so the population stays
// visually continuous instead of resetting.
export function continueRoute(cameras: Camera[], from: Camera): Camera[] {
  const stops = pickRoute(cameras.filter(c => c.camera_id !== from.camera_id), 1 + Math.floor(Math.random() * 3))
  return [from, ...stops]
}

export function assignKinds(count: number, blacklistTarget: number, suspiciousTarget: number): VehicleKind[] {
  const kinds: VehicleKind[] = []
  for (let i = 0; i < count; i++) {
    if (i < blacklistTarget) kinds.push('blacklisted')
    else if (i < blacklistTarget + suspiciousTarget) kinds.push('suspicious')
    else kinds.push('normal')
  }
  return kinds.sort(() => Math.random() - 0.5)
}
