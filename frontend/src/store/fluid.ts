import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SPHEngine, DEFAULT_PARAMS, PRESETS } from '../utils/sph-engine'
import type { SimParams, Preset, Recording, PlaybackSpeed, FrameSnapshot, Particle } from '../types'

const CANVAS_W = 800
const CANVAS_H = 500
const DEFAULT_PLAYBACK_FPS = 30

// inline poly6 for density recompute in playback
function poly6(r: number, h: number): number {
  if (r >= h) return 0
  const h2 = h * h
  const r2 = r * r
  const coeff = 315 / (64 * Math.PI * Math.pow(h, 9))
  return coeff * Math.pow(h2 - r2, 3)
}

export const useFluidStore = defineStore('fluid', () => {
  // ============ Simulation State ============
  const engine = ref<SPHEngine | null>(null)
  const isRunning = ref(false)
  const particleCount = ref(800)
  const currentPreset = ref<Preset>({ ...PRESETS[0] })
  const params = ref<SimParams>({ ...DEFAULT_PARAMS })
  const fps = ref(0)
  const frameCount = ref(0)
  let _animId: number | null = null
  let _lastTime = 0
  let _fpsAccum = 0
  let _fpsFrames = 0

  // ============ Recording State ============
  const isRecording = ref(false)
  let _recordFrameAccum = 0
  const _recordInterval = 1
  let _recordedFrames: FrameSnapshot[] = []
  let _recordStartSimFps = 0
  const recordings = ref<Recording[]>([])

  // ============ Playback State ============
  const isPlayback = ref(false)
  const isPlaybackPaused = ref(false)
  const currentRecordingId = ref<string | null>(null)
  const playbackFrame = ref(0)
  const playbackSpeed = ref<PlaybackSpeed>(1)
  let _playbackRafId: number | null = null
  let _playbackLastTime = 0
  let _playbackAccum = 0

  // ============ Getters ============
  const particleArray = computed(() => engine.value?.particles ?? [])
  const avgDensity = computed(() => {
    if (!engine.value || engine.value.particles.length === 0) return 0
    const sum = engine.value.particles.reduce((s: number, p: Particle) => s + p.density, 0)
    return sum / engine.value.particles.length
  })
  const maxVelocity = computed(() => {
    if (!engine.value || engine.value.particles.length === 0) return 0
    return Math.max(...engine.value.particles.map((p: Particle) => Math.sqrt(p.vx * p.vx + p.vy * p.vy)))
  })
  const currentRecording = computed<Recording | null>(() => {
    if (!currentRecordingId.value) return null
    return recordings.value.find((r: Recording) => r.id === currentRecordingId.value) ?? null
  })
  const playbackTotalFrames = computed(() => currentRecording.value?.frames.length ?? 0)
  const playbackDurationSeconds = computed(() => {
    const rec = currentRecording.value
    if (!rec || rec.fps === 0) return 0
    return rec.frames.length / rec.fps
  })
  const playbackCurrentTimeSeconds = computed(() => {
    const rec = currentRecording.value
    if (!rec || rec.fps === 0) return 0
    return playbackFrame.value / rec.fps
  })

  // ============ Simulation Actions ============
  function initSimulation(preset?: Preset) {
    stopPlayback()
    stopRecording()
    if (preset) {
      currentPreset.value = { ...preset }
      params.value = { ...DEFAULT_PARAMS, ...preset.params }
      particleCount.value = preset.particleCount
    }
    engine.value = new SPHEngine(particleCount.value, CANVAS_W, CANVAS_H, params.value)
    engine.value.initParticles(currentPreset.value.initialConfig, particleCount.value)
    frameCount.value = 0
    fps.value = 0
  }

  function start() {
    if (isRunning.value || !engine.value || isPlayback.value) return
    isRunning.value = true
    _lastTime = performance.now()
    _fpsAccum = 0
    _fpsFrames = 0
    const loop = (now: number) => {
      if (!isRunning.value || !engine.value) return
      const elapsed = now - _lastTime
      _lastTime = now
      _fpsAccum += elapsed
      _fpsFrames++
      if (_fpsAccum >= 500) {
        fps.value = Math.round(_fpsFrames / (_fpsAccum / 1000))
        _fpsAccum = 0
        _fpsFrames = 0
      }
      const subSteps = 3
      for (let s = 0; s < subSteps; s++) {
        engine.value.step()
      }
      frameCount.value++

      if (isRecording.value) {
        _recordFrameAccum++
        if (_recordFrameAccum >= _recordInterval) {
          _recordFrameAccum = 0
          _recordedFrames.push(engine.value.snapshot())
        }
      }

      _animId = requestAnimationFrame(loop)
    }
    _animId = requestAnimationFrame(loop)
  }

  function stop() {
    isRunning.value = false
    if (_animId !== null) {
      cancelAnimationFrame(_animId)
      _animId = null
    }
  }

  function reset() {
    stop()
    initSimulation(currentPreset.value)
  }

  function stepOnce() {
    if (!engine.value || isRunning.value || isPlayback.value) return
    const subSteps = 3
    for (let s = 0; s < subSteps; s++) {
      engine.value.step()
    }
    frameCount.value++
    if (isRecording.value) {
      _recordedFrames.push(engine.value.snapshot())
    }
  }

  function updateParam(key: keyof SimParams, value: number) {
    params.value[key] = value
    if (engine.value) {
      engine.value.params[key] = value
      if (key === 'smoothingRadius') {
        ;(engine.value as any).cellSize = value
      }
    }
  }

  // ============ Recording Actions ============
  function startRecording() {
    if (isRecording.value || isPlayback.value) return
    if (!engine.value) return
    isRecording.value = true
    _recordedFrames = []
    _recordFrameAccum = 0
    _recordStartSimFps = fps.value > 0 ? fps.value : DEFAULT_PLAYBACK_FPS
    _recordedFrames.push(engine.value.snapshot())
  }

  function stopRecording() {
    if (!isRecording.value) return
    isRecording.value = false
    if (_recordedFrames.length === 0) return

    const now = Date.now()
    const id = `rec_${now}_${Math.random().toString(36).slice(2, 8)}`
    const name = `${currentPreset.value.label} - ${new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`

    const rec: Recording = {
      id,
      name,
      createdAt: now,
      presetName: currentPreset.value.name,
      presetLabel: currentPreset.value.label,
      params: { ...params.value },
      particleCount: particleCount.value,
      frames: _recordedFrames,
      canvasWidth: CANVAS_W,
      canvasHeight: CANVAS_H,
      fps: _recordStartSimFps > 0 ? _recordStartSimFps : DEFAULT_PLAYBACK_FPS,
    }
    recordings.value.push(rec)
  }

  function renameRecording(id: string, name: string) {
    const rec = recordings.value.find((r: Recording) => r.id === id)
    if (rec) rec.name = name
  }

  function deleteRecording(id: string) {
    if (currentRecordingId.value === id) {
      stopPlayback()
    }
    const idx = recordings.value.findIndex((r: Recording) => r.id === id)
    if (idx >= 0) recordings.value.splice(idx, 1)
  }

  function exportRecording(id: string) {
    const rec = recordings.value.find((r: Recording) => r.id === id)
    if (!rec) return
    const json = JSON.stringify(rec)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${rec.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function importRecording(file: File) {
    try {
      const text = await file.text()
      const rec = JSON.parse(text) as Recording
      if (!rec || !rec.id || !Array.isArray(rec.frames) || rec.frames.length === 0) {
        throw new Error('无效的录制文件')
      }
      rec.id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      recordings.value.push(rec)
    } catch (e) {
      console.error('导入录制失败:', e)
      alert('导入录制失败：文件格式不正确')
    }
  }

  // ============ Playback Actions ============
  function _applyPlaybackFrame() {
    const rec = currentRecording.value
    if (!rec || !engine.value) return
    const frame = rec.frames[playbackFrame.value]
    if (frame) {
      engine.value.restore(frame)
      // Recompute density/pressure for stats display
      const { smoothingRadius, restDensity, gasConstant, particleMass } = engine.value.params
      const h = smoothingRadius
      const m = particleMass
      const n = engine.value.particles.length
      ;(engine.value as any).buildGrid()
      for (let i = 0; i < n; i++) {
        const pi = engine.value.particles[i]
        let density = 0
        const neighbors = (engine.value as any).getNeighbors(pi.x, pi.y) as number[]
        for (const j of neighbors) {
          const pj = engine.value.particles[j]
          const dx = pi.x - pj.x
          const dy = pi.y - pj.y
          const r = Math.sqrt(dx * dx + dy * dy)
          density += m * poly6(r, h)
        }
        pi.density = Math.max(density, restDensity * 0.1)
        pi.pressure = gasConstant * (pi.density - restDensity)
      }
    }
  }

  function _startPlaybackLoop() {
    if (_playbackRafId !== null) {
      cancelAnimationFrame(_playbackRafId)
      _playbackRafId = null
    }
    const loop = (now: number) => {
      if (!isPlayback.value) return
      const rec = currentRecording.value
      if (!rec) return

      const elapsed = now - _playbackLastTime
      _playbackLastTime = now

      if (!isPlaybackPaused.value) {
        _playbackAccum += elapsed * playbackSpeed.value
        const frameMs = 1000 / rec.fps
        while (_playbackAccum >= frameMs) {
          _playbackAccum -= frameMs
          const next = playbackFrame.value + 1
          if (next >= rec.frames.length) {
            playbackFrame.value = 0
          } else {
            playbackFrame.value = next
          }
          _applyPlaybackFrame()
        }
      }

      _playbackRafId = requestAnimationFrame(loop)
    }
    _playbackRafId = requestAnimationFrame(loop)
  }

  function startPlayback(recordingId: string) {
    const rec = recordings.value.find((r: Recording) => r.id === recordingId)
    if (!rec || rec.frames.length === 0) return

    stop()
    stopRecording()

    currentRecordingId.value = recordingId
    const matchedPreset = PRESETS.find(p => p.name === rec.presetName) ?? PRESETS[0]
    currentPreset.value = { ...matchedPreset }
    params.value = { ...rec.params }
    particleCount.value = rec.particleCount
    engine.value = new SPHEngine(rec.particleCount, CANVAS_W, CANVAS_H, rec.params)
    engine.value.initParticles(rec.presetName as any, rec.particleCount)

    isPlayback.value = true
    isPlaybackPaused.value = false
    playbackFrame.value = 0
    _applyPlaybackFrame()

    _playbackLastTime = performance.now()
    _playbackAccum = 0
    _startPlaybackLoop()
  }

  function pausePlayback() {
    isPlaybackPaused.value = true
  }

  function resumePlayback() {
    if (!isPlayback.value) return
    isPlaybackPaused.value = false
    _playbackLastTime = performance.now()
  }

  function togglePlaybackPause() {
    if (isPlaybackPaused.value) {
      resumePlayback()
    } else {
      pausePlayback()
    }
  }

  function setPlaybackFrame(frame: number) {
    const rec = currentRecording.value
    if (!rec) return
    playbackFrame.value = Math.max(0, Math.min(Math.floor(frame), rec.frames.length - 1))
    _applyPlaybackFrame()
  }

  function setPlaybackSpeed(speed: PlaybackSpeed) {
    playbackSpeed.value = speed
  }

  function stopPlayback() {
    if (_playbackRafId !== null) {
      cancelAnimationFrame(_playbackRafId)
      _playbackRafId = null
    }
    isPlayback.value = false
    isPlaybackPaused.value = false
    currentRecordingId.value = null
    playbackFrame.value = 0
    _playbackAccum = 0
  }

  return {
    // state
    engine,
    isRunning,
    particleCount,
    currentPreset,
    params,
    fps,
    frameCount,
    isRecording,
    _recordedFrames,
    recordings,
    isPlayback,
    isPlaybackPaused,
    currentRecordingId,
    playbackFrame,
    playbackSpeed,

    // getters
    particleArray,
    avgDensity,
    maxVelocity,
    currentRecording,
    playbackTotalFrames,
    playbackDurationSeconds,
    playbackCurrentTimeSeconds,

    // actions
    initSimulation,
    start,
    stop,
    reset,
    stepOnce,
    updateParam,
    startRecording,
    stopRecording,
    renameRecording,
    deleteRecording,
    exportRecording,
    importRecording,
    startPlayback,
    pausePlayback,
    resumePlayback,
    togglePlaybackPause,
    setPlaybackFrame,
    setPlaybackSpeed,
    stopPlayback,
  }
})
