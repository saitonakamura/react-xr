import React from 'react'
import { XRController } from './XRController'
import { XREventType, XRHandedness } from 'three'
import { XRContext } from './context'

export interface XREvent {
  originalEvent: any
  controller: XRController
}

export const useXREvent = (
  event: Exclude<XREventType, 'end' | 'inputsourceschange'>,
  handler: (e: XREvent) => any,
  { handedness }: { handedness?: XRHandedness } = {}
) => {
  const handlerRef = React.useRef<(e: XREvent) => any>(handler)
  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])
  const { controllers: allControllers } = React.useContext(XRContext)

  React.useEffect(() => {
    const controllers = handedness ? allControllers.filter((it) => it.inputSource.handedness === handedness) : allControllers

    const cleanups: any[] = []

    controllers.forEach((it) => {
      const listener = (e: any) => handlerRef.current({ originalEvent: e, controller: it })
      it.controller.addEventListener(event, listener)
      cleanups.push(() => it.controller.removeEventListener(event, listener))
    })

    return () => cleanups.forEach((fn) => fn())
  }, [event, allControllers, handedness])
}
