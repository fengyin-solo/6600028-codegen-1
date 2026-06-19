import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { SPHEngine, DEFAULT_PARAMS, PRESETS } from '../utils/sph-engine'
import type { SimParams, Preset, Recording, PlaybackSpeed, FrameSnapshot, Particle } from '../types'

const CANVAS_W = 800
const CANVAS_H = 500
const DEFAULT_PLAYBACK_FPS = 30
const STORAGE_KEY = 'sph-fluid-recordings-v1'
const STORAGE_WARN_THRESHOLD = 4 * 1024 * 1024 // 4MB 警告
const STORAGE_MAX_SOFT = 8 * 1024 * 1024 // 8MB 软限制

// inline poly6 for density recompute in playback
function poly6(r: number, h: number): number {
  if (r >= h) return 0
  const h2 = h * h
  const r2 = r * r
  const coeff = 315 / (64 * Math.PI * Math.pow(h, 9))
  return coeff * Math.pow(h2 - r2, 3)
}

function estimateRecordingBytes(rec: Recording): number {
  return rec.frames.length * rec.particleCount * 16 // 4 floats × 4 bytes
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
  const storageError = ref<string | null>(null)
  const storageUsedBytes = ref(0)
  const isPersisting = ref(false)

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
  const storageUsedKB = computed(() => (storageUsedBytes.value / 1024).toFixed(1))
  const storageUsedMB = computed(() => (storageUsedBytes.value / 1024 / 1024).toFixed(2))
  const storageNearLimit = computed(() => storageUsedBytes.value >= STORAGE_WARN_THRESHOLD)

  // ============ Persistence ============
  function _recalcStorageUsed() {
    storageUsedBytes.value = recordings.value.reduce(
      (sum, rec) => sum + estimateRecordingBytes(rec),
      0
    )
  }

  async function _persistToStorage(): Promise<{ success: boolean; error?: string }> {
    if (typeof localStorage === 'undefined') {
      return { success: false, error: '当前环境不支持 localStorage' }
    }
    isPersisting.value = true
    storageError.value = null
    try {
      const totalBytes = recordings.value.reduce(
        (sum, rec) => sum + estimateRecordingBytes(rec),
        0
      )
      if (totalBytes > STORAGE_MAX_SOFT) {
        const msg = `录制数据过大（约 ${(totalBytes / 1024 / 1024).toFixed(2)} MB），可能超出浏览器存储限制。请导出为文件保存或删除部分旧录制。`
        storageError.value = msg
        return { success: false, error: msg }
      }

      const json = JSON.stringify(recordings.value)
      localStorage.setItem(STORAGE_KEY, json)
      _recalcStorageUsed()

      if (totalBytes >= STORAGE_WARN_THRESHOLD) {
        storageError.value = `已使用约 ${(totalBytes / 1024 / 1024).toFixed(2)} MB 存储空间，接近浏览器限制，建议及时导出重要录制。`
      }
      return { success: true }
    } catch (e: any) {
      let msg = '保存失败'
      if (e?.name === 'QuotaExceededError' || e?.message?.includes('quota')) {
        msg = '浏览器存储空间已满！请删除部分旧录制或导出为文件保存。'
      } else if (e?.message) {
        msg = e.message
      }
      storageError.value = msg
      console.error('[fluid store] persist error:', e)
      return { success: false, error: msg }
    } finally {
      isPersisting.value = false
    }
  }

  function _loadFromStorage() {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as Recording[]
      if (Array.isArray(data)) {
        const valid: Recording[] = []
        for (const rec of data) {
          if (
            rec &&
            typeof rec.id === 'string' &&
            typeof rec.name === 'string' &&
            Array.isArray(rec.frames) &&
            rec.frames.length > 0 &&
            rec.params &&
            typeof rec.particleCount === 'number'
          ) {
            valid.push(rec)
          }
        }
        recordings.value = valid
        _recalcStorageUsed()
        if (valid.length > 0 && valid.length !== data.length) {
          console.warn(`[fluid store] 已跳过 ${data.length - valid.length} 条损坏的录制数据`)
        }
      }
    } catch (e) {
      console.error('[fluid store] load from storage error:', e)
    }
  }

  function clearStorageError() {
    storageError.value = null
  }

  async function clearAllRecordings(): Promise<boolean> {
    if (!confirm('确定要删除所有已保存的录制吗？此操作不可撤销。')) {
      return false
    }
    stopPlayback()
    recordings.value = []
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      console.error('[fluid store] clear storage error:', e)
    }
    _recalcStorageUsed()
    storageError.value = null
    return true
  }

  let _persistTimeout: number | null = null
  watch(
    recordings,
    () => {
      if (_persistTimeout !== null) {
        clearTimeout(_persistTimeout)
      }
      _persistTimeout = window.setTimeout(() => {
        _persistToStorage()
      }, 300)
    },
    { deep: true }
  )

  try {
    if (typeof window !== 'undefined') {
      _loadFromStorage()
    }
  } catch (e) {
    // ignore
  }

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

  async function stopRecording() {
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

    const estimatedSize = estimateRecordingBytes(rec)
    const totalAfter = storageUsedBytes.value + estimatedSize
    if (totalAfter > STORAGE_MAX_SOFT) {
      const choice = confirm(
        `本次录制约 ${(estimatedSize / 1024 / 1024).toFixed(2)} MB，` +
        `加上已有数据共 ${(totalAfter / 1024 / 1024).toFixed(2)} MB，` +
        `可能超出浏览器存储上限。\n\n是否仍然保存？\n` +
        `（建议：点击"取消"后使用"导出"功能保存为文件）`
      )
      if (!choice) return
    }

    recordings.value.push(rec)
    const result = await _persistToStorage()
    if (!result.success && result.error) {
      alert(result.error)
    }
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
      const result = await _persistToStorage()
      if (!result.success && result.error) {
        alert(result.error)
      }
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
    storageError,
    storageUsedBytes,
    storageUsedKB,
    storageUsedMB,
    storageNearLimit,
    isPersisting,
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
    clearStorageError,
    clearAllRecordings,
  }
})
