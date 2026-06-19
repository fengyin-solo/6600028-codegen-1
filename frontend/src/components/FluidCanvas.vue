<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useFluidStore } from '../store/fluid'

const store = useFluidStore()
const canvas = ref<HTMLCanvasElement | null>(null)

const W = 800
const H = 500

function velocityToColor(speed: number): string {
  // Blue (slow) -> Green (medium) -> Red (fast)
  const maxSpeed = 200
  const t = Math.min(speed / maxSpeed, 1)
  const hue = (1 - t) * 240 // 240=blue, 120=green, 0=red
  const sat = 80
  const light = 40 + t * 20
  return `hsl(${hue}, ${sat}%, ${light}%)`
}

function formatPlaybackTime(sec: number): string {
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec - Math.floor(sec)) * 100)
  return `${s}.${ms.toString().padStart(2, '0')}s`
}

function draw() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return

  // Clear
  ctx.fillStyle = '#0c1222'
  ctx.fillRect(0, 0, W, H)

  // Draw boundary walls
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = 3
  ctx.strokeRect(2, 2, W - 4, H - 4)

  // Draw grid (faint)
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 0.3
  for (let x = 0; x < W; x += 50) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 0; y < H; y += 50) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }

  if (!store.engine) return

  // Draw density heatmap background (low-res)
  const gridSize = 20
  const gw = Math.ceil(W / gridSize)
  const gh = Math.ceil(H / gridSize)
  const densityGrid = new Float32Array(gw * gh)
  for (const p of store.engine.particles) {
    const gx = Math.floor(p.x / gridSize)
    const gy = Math.floor(p.y / gridSize)
    if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) {
      densityGrid[gy * gw + gx] += p.density
    }
  }
  const maxDens = Math.max(...densityGrid, 1)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const d = densityGrid[gy * gw + gx]
      if (d > 0) {
        const alpha = Math.min(d / maxDens * 0.15, 0.15)
        ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`
        ctx.fillRect(gx * gridSize, gy * gridSize, gridSize, gridSize)
      }
    }
  }

  // Draw particles
  const particles = store.engine.particles
  for (const p of particles) {
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
    const color = velocityToColor(speed)
    const radius = 4

    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }

  // ===== Overlay: Recording / Playback state =====

  // Recording badge (top-left)
  if (store.isRecording) {
    const badgeW = 130
    const badgeH = 28
    const bx = 10
    const by = 10
    ctx.fillStyle = 'rgba(220, 38, 38, 0.9)'
    ctx.beginPath()
    ctx.roundRect(bx, by, badgeW, badgeH, 6)
    ctx.fill()

    // pulsing dot
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300)
    ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`
    ctx.beginPath()
    ctx.arc(bx + 18, by + 14, 5, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#fff'
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText('录制中 REC', bx + 32, by + 17)

    // Frame count
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(bx, by + badgeH + 4, 110, 22)
    ctx.fillStyle = '#fecaca'
    ctx.font = '11px monospace'
    ctx.fillText(`${store._recordedFrames.length} frames`, bx + 10, by + badgeH + 20)
  }

  // Playback progress bar (bottom)
  if (store.isPlayback && store.currentRecording) {
    const barH = 6
    const barY = H - barH - 2
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)'
    ctx.fillRect(0, barY - 2, W, barH + 4)

    const total = store.playbackTotalFrames
    const progress = total > 1 ? store.playbackFrame / (total - 1) : 0
    // Background
    ctx.fillStyle = '#334155'
    ctx.fillRect(4, barY, W - 8, barH)
    // Progress
    const grad = ctx.createLinearGradient(0, barY, W, barY)
    grad.addColorStop(0, '#a855f7')
    grad.addColorStop(1, '#ec4899')
    ctx.fillStyle = grad
    ctx.fillRect(4, barY, (W - 8) * progress, barH)

    // Playback badge (top-left)
    const pBadgeW = 180
    const pBadgeH = 28
    const pbx = 10
    const pby = 10
    ctx.fillStyle = store.isPlaybackPaused
      ? 'rgba(245, 158, 11, 0.9)'
      : 'rgba(147, 51, 234, 0.9)'
    ctx.beginPath()
    ctx.roundRect(pbx, pby, pBadgeW, pBadgeH, 6)
    ctx.fill()

    ctx.fillStyle = '#fff'
    if (store.isPlaybackPaused) {
      // pause icon ||
      ctx.fillRect(pbx + 14, pby + 9, 4, 10)
      ctx.fillRect(pbx + 22, pby + 9, 4, 10)
    } else {
      // play icon ▶
      ctx.beginPath()
      ctx.moveTo(pbx + 14, pby + 8)
      ctx.lineTo(pbx + 26, pby + 14)
      ctx.lineTo(pbx + 14, pby + 20)
      ctx.closePath()
      ctx.fill()
    }

    ctx.font = 'bold 12px sans-serif'
    const statusTxt = store.isPlaybackPaused ? '回放已暂停' : '回放中'
    ctx.fillText(
      `${statusTxt} ${store.playbackSpeed}x`,
      pbx + 36,
      pby + 17
    )

    // Time badge (top-right)
    const tBadgeW = 140
    const tBadgeH = 28
    const tbx = W - tBadgeW - 10
    const tby = 10
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)'
    ctx.beginPath()
    ctx.roundRect(tbx, tby, tBadgeW, tBadgeH, 6)
    ctx.fill()
    ctx.fillStyle = '#e9d5ff'
    ctx.font = '12px monospace'
    const curTime = formatPlaybackTime(store.playbackCurrentTimeSeconds)
    const totalTime = formatPlaybackTime(store.playbackDurationSeconds)
    const frameTxt = `${store.playbackFrame}/${total - 1}`
    const timeTxt = `${curTime} / ${totalTime}`
    ctx.fillText(timeTxt, tbx + 10, tby + 17)

    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)'
    ctx.beginPath()
    ctx.roundRect(tbx, tby + pBadgeH + 4, 110, 22, 4)
    ctx.fill()
    ctx.fillStyle = '#c4b5fd'
    ctx.font = '11px monospace'
    ctx.fillText(frameTxt, tbx + 10, tby + pBadgeH + 20)
  } else {
    // Normal FPS overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(W - 80, 5, 75, 22)
    ctx.fillStyle = '#22c55e'
    ctx.font = 'bold 12px monospace'
    ctx.fillText(`FPS: ${store.fps}`, W - 74, 20)

    // Frame count
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(W - 120, 30, 115, 22)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '11px monospace'
    ctx.fillText(`Frame: ${store.frameCount}`, W - 114, 44)
  }
}

let raf: number | null = null
function animate() {
  draw()
  raf = requestAnimationFrame(animate)
}

function onClick(e: MouseEvent) {
  // Disable click impulse during recording or playback to avoid confusing state
  if (!store.engine || !canvas.value || store.isRecording || store.isPlayback) return
  const rect = canvas.value.getBoundingClientRect()
  const scaleX = W / rect.width
  const scaleY = H / rect.height
  const x = (e.clientX - rect.left) * scaleX
  const y = (e.clientY - rect.top) * scaleY
  store.engine.applyImpulse(x, y, 300)
}

onMounted(() => {
  animate()
})

onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="relative">
    <canvas
      ref="canvas"
      :width="W"
      :height="H"
      class="rounded-lg border border-gray-700 w-full max-w-[800px] transition"
      :class="{
        'cursor-crosshair': !store.isRecording && !store.isPlayback,
        'cursor-not-allowed border-red-700/60': store.isRecording,
        'cursor-default border-purple-700/60': store.isPlayback,
      }"
      @click="onClick"
    />
  </div>
</template>
