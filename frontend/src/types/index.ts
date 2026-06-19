export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  density: number;
  pressure: number;
  fx: number;
  fy: number;
}

export interface SimParams {
  gravity: number;
  viscosity: number;
  restDensity: number;
  gasConstant: number;
  smoothingRadius: number;
  particleMass: number;
  dt: number;
  damping: number;
  boundaryStiffness: number;
}

export interface Preset {
  name: string;
  label: string;
  description: string;
  params: Partial<SimParams>;
  particleCount: number;
  initialConfig: 'dam' | 'drop' | 'fountain' | 'wave';
}

export interface ParticleSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FrameSnapshot {
  particles: ParticleSnapshot[];
}

export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  presetName: string;
  presetLabel: string;
  params: SimParams;
  particleCount: number;
  frames: FrameSnapshot[];
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}

export type PlaybackSpeed = 0.25 | 0.5 | 1 | 1.5 | 2 | 4;
