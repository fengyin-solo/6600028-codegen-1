import type { Particle, SimParams, Preset } from '../types'

export const DEFAULT_PARAMS: SimParams = {
  gravity: 9.8,
  viscosity: 1.0,
  restDensity: 1000,
  gasConstant: 2000,
  smoothingRadius: 16,
  particleMass: 2.5,
  dt: 0.004,
  damping: 0.5,
  boundaryStiffness: 10000,
}

export const PRESETS: Preset[] = [
  {
    name: 'dam',
    label: '溃坝模拟',
    description: '左侧水体突然释放，观察水流冲击和扩散',
    params: { gravity: 9.8, viscosity: 1.0, gasConstant: 2000, smoothingRadius: 16 },
    particleCount: 800,
    initialConfig: 'dam',
  },
  {
    name: 'drop',
    label: '水滴下落',
    description: '圆形水滴从高处自由落体，撞击底部表面',
    params: { gravity: 12.0, viscosity: 0.8, gasConstant: 1500, smoothingRadius: 14 },
    particleCount: 600,
    initialConfig: 'drop',
  },
  {
    name: 'fountain',
    label: '喷泉效果',
    description: '底部中心持续向上喷射粒子',
    params: { gravity: 8.0, viscosity: 1.2, gasConstant: 2500, smoothingRadius: 18 },
    particleCount: 1000,
    initialConfig: 'fountain',
  },
  {
    name: 'wave',
    label: '波浪运动',
    description: '正弦波初始分布，观察波浪传播和干涉',
    params: { gravity: 6.0, viscosity: 0.5, gasConstant: 1800, smoothingRadius: 15 },
    particleCount: 900,
    initialConfig: 'wave',
  },
]

// SPH Kernel constants
const PI = Math.PI

// Poly6 kernel for density computation
function poly6(r: number, h: number): number {
  if (r >= h) return 0
  const h2 = h * h
  const r2 = r * r
  const coeff = 315 / (64 * PI * Math.pow(h, 9))
  return coeff * Math.pow(h2 - r2, 3)
}

// Spiky kernel gradient for pressure force
function spikyGrad(r: number, h: number): number {
  if (r >= h || r < 1e-6) return 0
  const coeff = -45 / (PI * Math.pow(h, 6))
  return coeff * Math.pow(h - r, 2)
}

// Viscosity kernel Laplacian for viscosity force
function viscosityLaplacian(r: number, h: number): number {
  if (r >= h) return 0
  const coeff = 45 / (PI * Math.pow(h, 6))
  return coeff * (h - r)
}

export class SPHEngine {
  particles: Particle[] = []
  params: SimParams
  width: number
  height: number
  private grid: Map<number, number[]> = new Map()
  private cellSize: number = 0

  constructor(count: number, width: number, height: number, params?: Partial<SimParams>) {
    this.width = width
    this.height = height
    this.params = { ...DEFAULT_PARAMS, ...params }
    this.cellSize = this.params.smoothingRadius
  }

  initParticles(config: 'dam' | 'drop' | 'fountain' | 'wave', count?: number) {
    const n = count ?? this.particles.length || 800
    this.particles = []

    switch (config) {
      case 'dam': {
        // Particles in left 1/3, full height
        const spacing = 8
        const cols = Math.floor(this.width / 3 / spacing)
        const rows = Math.floor(this.height / spacing) - 2
        let placed = 0
        for (let j = 0; j < rows && placed < n; j++) {
          for (let i = 0; i < cols && placed < n; i++) {
            this.particles.push(this.createParticle(
              20 + i * spacing + (Math.random() - 0.5) * 2,
              10 + j * spacing + (Math.random() - 0.5) * 2
            ))
            placed++
          }
        }
        break
      }
      case 'drop': {
        // Circular blob at top center
        const cx = this.width / 2
        const cy = this.height * 0.25
        const radius = Math.sqrt(n) * 4
        let placed = 0
        for (let j = -radius; j < radius && placed < n; j += 6) {
          for (let i = -radius; i < radius && placed < n; i += 6) {
            if (i * i + j * j < radius * radius) {
              this.particles.push(this.createParticle(
                cx + i + (Math.random() - 0.5) * 2,
                cy + j + (Math.random() - 0.5) * 2
              ))
              placed++
            }
          }
        }
        // Fill remaining randomly within the circle
        while (this.particles.length < n) {
          const angle = Math.random() * 2 * PI
          const r = Math.sqrt(Math.random()) * radius
          this.particles.push(this.createParticle(
            cx + r * Math.cos(angle),
            cy + r * Math.sin(angle)
          ))
        }
        break
      }
      case 'fountain': {
        // Emit from bottom center
        const cx = this.width / 2
        for (let i = 0; i < n; i++) {
          const spread = 30
          const p = this.createParticle(
            cx + (Math.random() - 0.5) * spread,
            this.height - 20 - Math.random() * 30
          )
          p.vy = -80 - Math.random() * 60
          p.vx = (Math.random() - 0.5) * 40
          this.particles.push(p)
        }
        break
      }
      case 'wave': {
        // Sine wave pattern
        const spacing = 7
        const cols = Math.floor(this.width * 0.8 / spacing)
        const rows = Math.floor(n / cols)
        let placed = 0
        for (let i = 0; i < cols && placed < n; i++) {
          const waveHeight = 40 * Math.sin((i / cols) * 2 * PI)
          for (let j = 0; j < rows + 5 && placed < n; j++) {
            const x = this.width * 0.1 + i * spacing
            const y = this.height * 0.5 + waveHeight + j * spacing
            if (y < this.height - 5) {
              this.particles.push(this.createParticle(x, y))
              placed++
            }
          }
        }
        while (this.particles.length < n) {
          this.particles.push(this.createParticle(
            Math.random() * this.width * 0.8 + this.width * 0.1,
            Math.random() * this.height * 0.4 + this.height * 0.3
          ))
        }
        break
      }
    }
  }

  private createParticle(x: number, y: number): Particle {
    return { x, y, vx: 0, vy: 0, density: 0, pressure: 0, fx: 0, fy: 0 }
  }

  private buildGrid() {
    this.grid.clear()
    this.cellSize = this.params.smoothingRadius
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      const cx = Math.floor(p.x / this.cellSize)
      const cy = Math.floor(p.y / this.cellSize)
      const key = cx * 10000 + cy
      const cell = this.grid.get(key)
      if (cell) {
        cell.push(i)
      } else {
        this.grid.set(key, [i])
      }
    }
  }

  private getNeighbors(px: number, py: number): number[] {
    const result: number[] = []
    const cx = Math.floor(px / this.cellSize)
    const cy = Math.floor(py / this.cellSize)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = (cx + dx) * 10000 + (cy + dy)
        const cell = this.grid.get(key)
        if (cell) {
          for (const idx of cell) {
            result.push(idx)
          }
        }
      }
    }
    return result
  }

  step() {
    const { gravity, viscosity, restDensity, gasConstant, smoothingRadius, particleMass, dt, damping } = this.params
    const h = smoothingRadius
    const m = particleMass
    const n = this.particles.length

    // Step 1: Build spatial hash grid
    this.buildGrid()

    // Step 2: Compute density for each particle
    for (let i = 0; i < n; i++) {
      const pi = this.particles[i]
      let density = 0
      const neighbors = this.getNeighbors(pi.x, pi.y)
      for (const j of neighbors) {
        const pj = this.particles[j]
        const dx = pi.x - pj.x
        const dy = pi.y - pj.y
        const r = Math.sqrt(dx * dx + dy * dy)
        density += m * poly6(r, h)
      }
      pi.density = Math.max(density, restDensity * 0.1)
      // Step 3: Compute pressure
      pi.pressure = gasConstant * (pi.density - restDensity)
    }

    // Step 4-5: Compute forces (pressure + viscosity)
    for (let i = 0; i < n; i++) {
      const pi = this.particles[i]
      let fpx = 0, fpy = 0
      let fvx = 0, fvy = 0

      const neighbors = this.getNeighbors(pi.x, pi.y)
      for (const j of neighbors) {
        if (i === j) continue
        const pj = this.particles[j]
        const dx = pi.x - pj.x
        const dy = pi.y - pj.y
        const r = Math.sqrt(dx * dx + dy * dy)
        if (r < 1e-6 || r >= h) continue

        // Direction unit vector
        const nx = dx / r
        const ny = dy / r

        // Pressure force (Spiky gradient)
        const pressureForce = -m * (pi.pressure + pj.pressure) / (2 * pj.density) * spikyGrad(r, h)
        fpx += pressureForce * nx
        fpy += pressureForce * ny

        // Viscosity force (Laplacian)
        const viscForce = viscosity * m / pj.density * viscosityLaplacian(r, h)
        fvx += viscForce * (pj.vx - pi.vx)
        fvy += viscForce * (pj.vy - pi.vy)
      }

      // Step 6: Sum forces + gravity
      pi.fx = fpx + fvx
      pi.fy = fpy + fvy + pi.density * gravity * 10  // gravity scaled
    }

    // Step 7: Update velocity + position (Symplectic Euler)
    for (let i = 0; i < n; i++) {
      const p = this.particles[i]
      const ax = p.fx / p.density
      const ay = p.fy / p.density
      p.vx += ax * dt
      p.vy += ay * dt
      p.x += p.vx * dt
      p.y += p.vy * dt

      // Step 8: Boundary collision
      const margin = 5
      if (p.x < margin) {
        p.x = margin
        p.vx = Math.abs(p.vx) * damping
      }
      if (p.x > this.width - margin) {
        p.x = this.width - margin
        p.vx = -Math.abs(p.vx) * damping
      }
      if (p.y < margin) {
        p.y = margin
        p.vy = Math.abs(p.vy) * damping
      }
      if (p.y > this.height - margin) {
        p.y = this.height - margin
        p.vy = -Math.abs(p.vy) * damping
      }
    }
  }

  applyImpulse(x: number, y: number, strength: number) {
    const radius = 80
    for (const p of this.particles) {
      const dx = p.x - x
      const dy = p.y - y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < radius && dist > 0.1) {
        const factor = strength * (1 - dist / radius)
        p.vx += (dx / dist) * factor
        p.vy += (dy / dist) * factor
      }
    }
  }
}
