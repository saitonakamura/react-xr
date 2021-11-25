import React from 'react'
import type { Group } from 'three'
import type { XRInteractionNoIntersectionEvent } from './Interactions'
import type { XRController } from './XRController'

export type GlobalOnSelectMissed = (event: Omit<XRInteractionNoIntersectionEvent, 'eventObject'>) => void

export const XRContext = React.createContext<XRContextValue>({} as any)

export interface XRContextValue {
  controllers: XRController[]
  isPresenting: boolean
  player: Group
  isHandTracking: boolean
  onSelectMissed?: GlobalOnSelectMissed
}
