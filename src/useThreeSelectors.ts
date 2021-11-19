import type { RootState } from '@react-three/fiber'

export const getCamera = (s: RootState) => s.camera
export const getGl = (s: RootState) => s.gl
export const getScene = (s: RootState) => s.scene