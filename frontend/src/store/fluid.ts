import { defineStore } from 'pinia'
import { SPHEngine, DEFAULT_PARAMS, PRESETS } from '../utils/sph-engine'
import type { SimParams, Preset, Particle } from '../types'

export const useFluidStore = defineStore('fluid', {
  state: () => ({
    engine: null as SPHEngine | null,
    isRunning: false,
    particleCount: 800,
    currentPreset: PRESETS[0],
    params: { ...DEFAULT_PARAMS } as SimParams,
    fps: 0,
    frameCount: 0,
    _animId: null as number | null,
    _lastTime: 0,
    _fpsAccum: 0,
    _fpsFrames: 0,
  }),
  getters: {
    particleArray: (state) => state.engine?.particles ?? [],
    avgDensity: (state) => {
      if (!state.engine || state.engine.particles.length === 0) return 0
      const sum = state.engine.particles.reduce((s, p) => s + p.density, 0)
      return sum / state.engine.particles.length
    },
    maxVelocity: (state) => {
      if (!state.engine || state.engine.particles.length === 0) return 0
      return Math.max(...state.engine.particles.map(p => Math.sqrt(p.vx * p.vx + p.vy * p.vy)))
    },
  },
  actions: {
    initSimulation(preset?: Preset) {
      if (preset) {
        this.currentPreset = preset
        this.params = { ...DEFAULT_PARAMS, ...preset.params }
        this.particleCount = preset.particleCount
      }
      const canvas = { width: 800, height: 500 }
      this.engine = new SPHEngine(this.particleCount, canvas.width, canvas.height, this.params)
      this.engine.initParticles(this.currentPreset.initialConfig, this.particleCount)
      this.frameCount = 0
      this.fps = 0
    },
    start() {
      if (this.isRunning || !this.engine) return
      this.isRunning = true
      this._lastTime = performance.now()
      this._fpsAccum = 0
      this._fpsFrames = 0
      const loop = (now: number) => {
        if (!this.isRunning || !this.engine) return
        const elapsed = now - this._lastTime
        this._lastTime = now
        this._fpsAccum += elapsed
        this._fpsFrames++
        if (this._fpsAccum >= 500) {
          this.fps = Math.round(this._fpsFrames / (this._fpsAccum / 1000))
          this._fpsAccum = 0
          this._fpsFrames = 0
        }
        // Sub-steps for stability
        const subSteps = 3
        for (let s = 0; s < subSteps; s++) {
          this.engine.step()
        }
        this.frameCount++
        this._animId = requestAnimationFrame(loop)
      }
      this._animId = requestAnimationFrame(loop)
    },
    stop() {
      this.isRunning = false
      if (this._animId !== null) {
        cancelAnimationFrame(this._animId)
        this._animId = null
      }
    },
    reset() {
      this.stop()
      this.initSimulation(this.currentPreset)
    },
    stepOnce() {
      if (!this.engine || this.isRunning) return
      const subSteps = 3
      for (let s = 0; s < subSteps; s++) {
        this.engine.step()
      }
      this.frameCount++
    },
    updateParam(key: keyof SimParams, value: number) {
      this.params[key] = value
      if (this.engine) {
        this.engine.params[key] = value
        if (key === 'smoothingRadius') {
          this.engine['cellSize'] = value
        }
      }
    },
  },
})
