<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFluidStore } from '../store/fluid'
import { PRESETS } from '../utils/sph-engine'
import type { Preset, PlaybackSpeed, Recording } from '../types'

const store = useFluidStore()

function selectPreset(preset: Preset) {
  store.initSimulation(preset)
}

function toggleRun() {
  if (store.isRunning) {
    store.stop()
  } else {
    store.start()
  }
}

function reset() {
  store.reset()
}

function stepOnce() {
  store.stepOnce()
}

function onGravity(e: Event) {
  store.updateParam('gravity', parseFloat((e.target as HTMLInputElement).value))
}
function onViscosity(e: Event) {
  store.updateParam('viscosity', parseFloat((e.target as HTMLInputElement).value))
}
function onSmoothingRadius(e: Event) {
  store.updateParam('smoothingRadius', parseFloat((e.target as HTMLInputElement).value))
}
function onParticleCount(e: Event) {
  store.particleCount = parseInt((e.target as HTMLInputElement).value)
}
function onDt(e: Event) {
  store.updateParam('dt', parseFloat((e.target as HTMLInputElement).value))
}

// ============ Recording ============
const editingId = ref<string | null>(null)
const editingName = ref('')

function toggleRecording() {
  if (store.isRecording) {
    store.stopRecording()
  } else {
    store.startRecording()
  }
}

function playRecording(id: string) {
  store.startPlayback(id)
}

function startRename(id: string, name: string) {
  editingId.value = id
  editingName.value = name
}
function commitRename() {
  if (editingId.value && editingName.value.trim()) {
    store.renameRecording(editingId.value, editingName.value.trim())
  }
  editingId.value = null
}
function cancelRename() {
  editingId.value = null
}

function delRecording(id: string) {
  const rec = store.recordings.find((r: Recording) => r.id === id)
  if (!rec) return
  if (confirm(`确定删除录制"${rec.name}"吗？`)) {
    store.deleteRecording(id)
  }
}

function exportRec(id: string) {
  store.exportRecording(id)
}

const importInput = ref<HTMLInputElement | null>(null)
function triggerImport() {
  importInput.value?.click()
}
function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    store.importRecording(file)
    ;(e.target as HTMLInputElement).value = ''
  }
}

// ============ Playback ============
const speedOptions: PlaybackSpeed[] = [0.25, 0.5, 1, 1.5, 2, 4]

function onSeek(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  store.setPlaybackFrame(val)
}
function onSpeedChange(speed: PlaybackSpeed) {
  store.setPlaybackSpeed(speed)
}
function stopPlayback() {
  store.stopPlayback()
  store.initSimulation(store.currentPreset)
}

const playbackProgressPercent = computed(() => {
  const total = store.playbackTotalFrames
  if (total <= 0) return 0
  return Math.round((store.playbackFrame / (total - 1)) * 100)
})

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec - Math.floor(sec)) * 100)
  if (m > 0) {
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }
  return `${s}.${ms.toString().padStart(2, '0')}s`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function estimateSizeKB(frames: number, particles: number): string {
  const bytes = frames * particles * 4 * 4 // 4 floats per particle, 4 bytes each
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
</script>

<template>
  <div class="w-72 bg-gray-800 rounded-lg border border-gray-700 p-4 flex flex-col gap-4 overflow-auto h-full">
    <!-- Presets -->
    <div>
      <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">预设场景</h3>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="preset in PRESETS"
          :key="preset.name"
          @click="selectPreset(preset)"
          class="text-xs px-2 py-2 rounded transition text-left"
          :class="store.currentPreset.name === preset.name
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
          :disabled="store.isPlayback"
        >
          {{ preset.label }}
        </button>
      </div>
      <p class="text-xs text-gray-500 mt-1">{{ store.currentPreset.description }}</p>
    </div>

    <!-- Simulation Controls -->
    <div>
      <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">模拟控制</h3>
      <div class="flex gap-2">
        <button
          @click="toggleRun"
          class="flex-1 py-2 rounded text-sm font-medium transition"
          :class="store.isRunning
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-green-600 hover:bg-green-700 text-white'"
          :disabled="store.isPlayback"
        >
          {{ store.isRunning ? '暂停' : '开始' }}
        </button>
        <button
          @click="reset"
          class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 py-2 rounded text-sm transition"
          :disabled="store.isRecording"
        >
          重置
        </button>
        <button
          @click="stepOnce"
          :disabled="store.isRunning || store.isPlayback"
          class="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 py-2 rounded text-sm transition"
        >
          单步
        </button>
      </div>
    </div>

    <!-- Recording Controls -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">录制回放</h3>
        <button
          @click="triggerImport"
          class="text-xs text-blue-400 hover:text-blue-300 transition"
          title="导入录制文件"
        >
          ⬆ 导入
        </button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="onImportFile"
        />
      </div>

      <div class="flex gap-2 mb-3">
        <button
          @click="toggleRecording"
          class="flex-1 py-2 rounded text-sm font-medium transition flex items-center justify-center gap-1"
          :class="store.isRecording
            ? 'bg-red-700 hover:bg-red-800 text-white animate-pulse'
            : 'bg-rose-600 hover:bg-rose-700 text-white'"
          :disabled="store.isPlayback"
        >
          <span
            class="inline-block w-3 h-3 rounded-full"
            :class="store.isRecording ? 'bg-white' : 'bg-white'"
          ></span>
          {{ store.isRecording ? '停止录制' : '开始录制' }}
        </button>
      </div>

      <!-- Recording indicator -->
      <div v-if="store.isRecording" class="mb-3 bg-red-900/40 border border-red-700 rounded px-3 py-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-red-300 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>
            正在录制...
          </span>
          <span class="text-red-200 font-mono">
            {{ store._recordedFrames.length }} 帧
          </span>
        </div>
      </div>

      <!-- Playback Controls -->
      <div
        v-if="store.isPlayback && store.currentRecording"
        class="mb-3 bg-purple-900/30 border border-purple-700 rounded p-3 space-y-2"
      >
        <div class="flex items-center justify-between">
          <span class="text-purple-300 text-xs font-semibold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-purple-400"
              :class="{ 'animate-pulse': !store.isPlaybackPaused }"
            ></span>
            {{ store.isPlaybackPaused ? '回放已暂停' : '回放中' }}
          </span>
          <button
            @click="stopPlayback"
            class="text-xs text-gray-400 hover:text-red-400 transition"
          >
            ✕ 退出回放
          </button>
        </div>

        <!-- Play / Pause -->
        <div class="flex items-center gap-2">
          <button
            @click="store.togglePlaybackPause()"
            class="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition"
          >
            {{ store.isPlaybackPaused ? '▶ 继续' : '⏸ 暂停' }}
          </button>
          <div class="flex gap-1 flex-wrap">
            <button
              v-for="s in speedOptions"
              :key="s"
              @click="onSpeedChange(s)"
              class="px-2 py-1 rounded text-xs transition"
              :class="store.playbackSpeed === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
            >
              {{ s }}x
            </button>
          </div>
        </div>

        <!-- Seek bar -->
        <div>
          <div class="flex justify-between text-xs text-gray-400 mb-1">
            <span class="font-mono">{{ formatDuration(store.playbackCurrentTimeSeconds) }}</span>
            <span class="text-purple-300 font-mono">
              {{ store.playbackFrame }} / {{ store.playbackTotalFrames - 1 }}
              <span class="text-gray-500">({{ playbackProgressPercent }}%)</span>
            </span>
            <span class="font-mono">{{ formatDuration(store.playbackDurationSeconds) }}</span>
          </div>
          <input
            type="range"
            :min="0"
            :max="store.playbackTotalFrames - 1"
            :value="store.playbackFrame"
            @input="onSeek"
            class="w-full accent-purple-500 h-1.5"
          />
        </div>
      </div>

      <!-- Storage Warning -->
      <div
        v-if="store.storageError"
        class="mb-3 bg-amber-900/30 border border-amber-700 rounded px-3 py-2 text-xs text-amber-200"
      >
        <div class="flex items-start gap-2">
          <span class="text-amber-400 text-base leading-none">⚠</span>
          <div class="flex-1">
            <p>{{ store.storageError }}</p>
            <button
              @click="store.clearStorageError()"
              class="mt-1 text-amber-400 hover:text-amber-300 underline underline-offset-2"
            >
              关闭提示
            </button>
          </div>
        </div>
      </div>

      <!-- Storage Info -->
      <div
        v-if="store.recordings.length > 0"
        class="mb-3 bg-gray-900/70 border rounded px-3 py-2 text-xs"
        :class="store.storageNearLimit ? 'border-amber-700' : 'border-gray-700'"
      >
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-gray-400">本地存储</span>
          <div class="flex items-center gap-2">
            <span
              class="font-mono"
              :class="store.storageNearLimit ? 'text-amber-400' : 'text-gray-300'"
            >
              {{ store.storageUsedMB }} MB
            </span>
            <span v-if="store.isPersisting" class="text-green-400 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
              保存中
            </span>
            <button
              @click="store.clearAllRecordings()"
              class="text-red-400 hover:text-red-300 transition"
              title="清空所有录制"
            >
              🗑 清空
            </button>
          </div>
        </div>
        <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            class="h-full transition-all duration-300 rounded-full"
            :class="store.storageNearLimit ? 'bg-amber-500' : 'bg-blue-500'"
            :style="{ width: `${Math.min((store.storageUsedBytes / (8 * 1024 * 1024)) * 100, 100)}%` }"
          ></div>
        </div>
        <p class="text-[10px] text-gray-500 mt-1">
          浏览器存储空间有限（约 5-10 MB），重要录制请使用"导出"功能保存为文件。
        </p>
      </div>

      <!-- Recording List -->
      <div v-if="store.recordings.length > 0" class="space-y-2 max-h-52 overflow-auto pr-1">
        <div
          v-for="rec in [...store.recordings].reverse()"
          :key="rec.id"
          class="bg-gray-900 border rounded p-2.5 space-y-1.5 transition"
          :class="store.currentRecordingId === rec.id
            ? 'border-purple-500 ring-1 ring-purple-500/50'
            : 'border-gray-700 hover:border-gray-600'"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div v-if="editingId === rec.id" class="flex gap-1">
                <input
                  v-model="editingName"
                  @keyup.enter="commitRename"
                  @keyup.esc="cancelRename"
                  class="flex-1 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  autofocus
                />
                <button
                  @click="commitRename"
                  class="text-green-400 hover:text-green-300 text-xs px-1"
                >✓</button>
                <button
                  @click="cancelRename"
                  class="text-gray-400 hover:text-gray-300 text-xs px-1"
                >✕</button>
              </div>
              <div v-else class="truncate text-sm font-medium text-gray-200">
                {{ rec.name }}
              </div>
              <div class="text-[10px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                <span>{{ rec.presetLabel }}</span>
                <span>{{ formatDate(rec.createdAt) }}</span>
              </div>
            </div>
          </div>

          <div class="text-[10px] text-gray-500 flex flex-wrap gap-x-3">
            <span>🎬 {{ rec.frames.length }}帧</span>
            <span>⏱ {{ formatDuration(rec.frames.length / rec.fps) }}</span>
            <span>● {{ rec.particleCount }}粒子</span>
            <span>📦 {{ estimateSizeKB(rec.frames.length, rec.particleCount) }}</span>
          </div>

          <div class="flex gap-1 pt-1 border-t border-gray-700/50">
            <button
              v-if="store.currentRecordingId !== rec.id"
              @click="playRecording(rec.id)"
              class="flex-1 py-1 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white transition"
            >
              ▶ 播放
            </button>
            <button
              v-else
              @click="store.togglePlaybackPause()"
              class="flex-1 py-1 rounded text-xs bg-purple-500 hover:bg-purple-400 text-white transition"
            >
              {{ store.isPlaybackPaused ? '▶ 继续' : '⏸ 暂停' }}
            </button>
            <button
              @click="startRename(rec.id, rec.name)"
              class="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
              title="重命名"
            >✎</button>
            <button
              @click="exportRec(rec.id)"
              class="px-2 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-blue-100 transition"
              title="导出为 JSON 文件"
            >⬇</button>
            <button
              @click="delRecording(rec.id)"
              class="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white transition"
              title="删除"
            >🗑</button>
          </div>
        </div>
      </div>

      <div v-else class="text-xs text-gray-500 text-center py-3 bg-gray-900/50 rounded border border-dashed border-gray-700">
        暂无录制。点击"开始录制"按钮保存当前流体演化过程。
      </div>
    </div>

    <!-- Parameters (disabled during playback) -->
    <div class="space-y-3">
      <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">模拟参数</h3>

      <div>
        <label class="flex justify-between text-xs text-gray-400 mb-1">
          <span>重力</span>
          <span class="text-gray-300">{{ store.params.gravity.toFixed(1) }}</span>
        </label>
        <input
          type="range" min="0" max="20" step="0.1"
          :value="store.params.gravity"
          @input="onGravity"
          :disabled="store.isPlayback"
          class="w-full accent-blue-500 h-1.5 disabled:opacity-40"
        />
      </div>

      <div>
        <label class="flex justify-between text-xs text-gray-400 mb-1">
          <span>粘性</span>
          <span class="text-gray-300">{{ store.params.viscosity.toFixed(1) }}</span>
        </label>
        <input
          type="range" min="0" max="5" step="0.1"
          :value="store.params.viscosity"
          @input="onViscosity"
          :disabled="store.isPlayback"
          class="w-full accent-blue-500 h-1.5 disabled:opacity-40"
        />
      </div>

      <div>
        <label class="flex justify-between text-xs text-gray-400 mb-1">
          <span>光滑半径</span>
          <span class="text-gray-300">{{ store.params.smoothingRadius.toFixed(0) }}</span>
        </label>
        <input
          type="range" min="10" max="50" step="1"
          :value="store.params.smoothingRadius"
          @input="onSmoothingRadius"
          :disabled="store.isPlayback"
          class="w-full accent-blue-500 h-1.5 disabled:opacity-40"
        />
      </div>

      <div>
        <label class="flex justify-between text-xs text-gray-400 mb-1">
          <span>粒子数量</span>
          <span class="text-gray-300">{{ store.particleCount }}</span>
        </label>
        <input
          type="range" min="200" max="2000" step="50"
          :value="store.particleCount"
          @input="onParticleCount"
          :disabled="store.isPlayback || store.isRunning || store.isRecording"
          class="w-full accent-blue-500 h-1.5 disabled:opacity-40"
        />
        <p class="text-xs text-gray-600 mt-0.5">重置后生效</p>
      </div>

      <div>
        <label class="flex justify-between text-xs text-gray-400 mb-1">
          <span>时间步长</span>
          <span class="text-gray-300">{{ store.params.dt.toFixed(4) }}</span>
        </label>
        <input
          type="range" min="0.001" max="0.02" step="0.001"
          :value="store.params.dt"
          @input="onDt"
          :disabled="store.isPlayback"
          class="w-full accent-blue-500 h-1.5 disabled:opacity-40"
        />
      </div>
    </div>

    <!-- Stats -->
    <div class="mt-auto pt-3 border-t border-gray-700">
      <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">运行状态</h3>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="bg-gray-900 rounded px-2 py-1.5">
          <span class="text-gray-500">FPS</span>
          <p class="text-green-400 font-mono text-sm">{{ store.fps }}</p>
        </div>
        <div class="bg-gray-900 rounded px-2 py-1.5">
          <span class="text-gray-500">粒子数</span>
          <p class="text-blue-400 font-mono text-sm">{{ store.particleArray.length }}</p>
        </div>
        <div class="bg-gray-900 rounded px-2 py-1.5">
          <span class="text-gray-500">平均密度</span>
          <p class="text-yellow-400 font-mono text-sm">{{ store.avgDensity.toFixed(0) }}</p>
        </div>
        <div class="bg-gray-900 rounded px-2 py-1.5">
          <span class="text-gray-500">最大速度</span>
          <p class="text-red-400 font-mono text-sm">{{ store.maxVelocity.toFixed(1) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
