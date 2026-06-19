# solo-6600028: 流体力学 SPH 粒子模拟器

## 技术栈
- Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS + Canvas 2D

## 核心特性
1. **SPH 光滑粒子流体动力学**：Poly6/Spiky/Viscosity 核函数
2. **空间哈希网格**：O(n) 邻域搜索加速
3. **4 种预设场景**：溃坝(Dam Break)、水滴(Drop)、喷泉(Fountain)、波浪(Wave)
4. **速度着色**：粒子颜色随速度变化（蓝→绿→红）
5. **密度热力图**：背景密度场可视化
6. **鼠标交互**：点击施加冲量，推动粒子
7. **实时参数调节**：重力、粘度、平滑半径、粒子数量
