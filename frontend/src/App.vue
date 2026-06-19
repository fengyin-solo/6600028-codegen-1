<script setup lang="ts">
import { onMounted } from 'vue'
import { useFluidStore } from './store/fluid'
import { PRESETS } from './utils/sph-engine'
import FluidCanvas from './components/FluidCanvas.vue'
import ControlPanel from './components/ControlPanel.vue'

const store = useFluidStore()

onMounted(() => {
  store.initSimulation(PRESETS[0])
})
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
    <!-- Header -->
    <header class="bg-gray-800 border-b border-gray-700 px-6 py-4">
      <h1 class="text-xl font-bold text-white tracking-wide">流体力学 SPH 粒子模拟器</h1>
      <p class="text-xs text-gray-500 mt-1">Smoothed Particle Hydrodynamics — 点击画布施加冲量</p>
    </header>

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden p-4 gap-4">
      <!-- Left: Canvas -->
      <div class="flex-1 flex flex-col items-start gap-2">
        <FluidCanvas />
      </div>

      <!-- Right: Controls -->
      <div class="flex-shrink-0">
        <ControlPanel />
      </div>
    </div>

    <!-- Bottom Stats Bar -->
    <footer class="bg-gray-800 border-t border-gray-700 px-6 py-2 flex items-center gap-6 text-xs flex-wrap">
      <div v-if="store.isRecording" class="flex items-center gap-2 bg-red-900/40 border border-red-700 px-3 py-1 rounded">
        <span class="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>
        <span class="text-red-300 font-semibold">正在录制</span>
        <span class="text-red-200 font-mono">{{ store._recordedFrames.length }} 帧</span>
      </div>
      <div v-else-if="store.isPlayback" class="flex items-center gap-2 bg-purple-900/40 border border-purple-700 px-3 py-1 rounded">
        <span
          class="w-2 h-2 rounded-full"
          :class="store.isPlaybackPaused ? 'bg-amber-400' : 'bg-purple-400 animate-pulse'"
        ></span>
        <span class="text-purple-300 font-semibold">
          {{ store.isPlaybackPaused ? '回放暂停' : '回放中' }}
        </span>
        <span class="text-purple-200 font-mono">
          {{ store.playbackFrame }}/{{ store.playbackTotalFrames - 1 }}
          @ {{ store.playbackSpeed }}x
        </span>
        <span v-if="store.currentRecording" class="text-purple-300">
          · {{ store.currentRecording.name }}
        </span>
      </div>
      <div v-else class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full"
          :class="store.isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'"
        ></span>
        <span class="text-gray-300">
          {{ store.isRunning ? '模拟运行中' : '模拟已暂停' }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-gray-500">FPS:</span>
        <span class="text-green-400 font-mono">{{ store.fps }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-gray-500">粒子:</span>
        <span class="text-blue-400 font-mono">{{ store.particleArray.length }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-gray-500">平均密度:</span>
        <span class="text-yellow-400 font-mono">{{ store.avgDensity.toFixed(1) }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-gray-500">最大速度:</span>
        <span class="text-red-400 font-mono">{{ store.maxVelocity.toFixed(1) }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-gray-500">当前预设:</span>
        <span class="text-purple-400">{{ store.currentPreset.label }}</span>
      </div>
      <div v-if="store.recordings.length > 0" class="flex items-center gap-2">
        <span class="text-gray-500">已保存录制:</span>
        <span class="text-rose-400 font-mono">{{ store.recordings.length }}</span>
      </div>
      <div class="flex items-center gap-2 ml-auto">
        <span class="text-gray-500">帧数:</span>
        <span class="text-gray-300 font-mono">{{ store.frameCount }}</span>
      </div>
    </footer>
  </div>
</template>
