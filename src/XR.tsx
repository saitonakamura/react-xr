/* eslint-disable @typescript-eslint/no-non-null-assertion */

import * as React from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ARButton } from './webxr/ARButton'
import { VRButton } from './webxr/VRButton'
import { XRController } from './XRController'
import { Props as ContainerProps } from '@react-three/fiber/dist/declarations/src/web/Canvas'
import { InteractionManager, InteractionsContext } from './Interactions'
import { XRContext, GlobalOnSelectMissed } from './context'
import {
  XRSessionInit,
  Group,
  Matrix4,
  XRFrame,
  XRHandedness,
  XRHitTestResult,
  XRHitTestSource,
  XRInputSourceChangeEvent,
  XRReferenceSpace
} from 'three'
import { getGl, getCamera } from './useThreeSelectors'

export type { XRContextValue } from './context'

export const useXR = () => {
  const xrValue = React.useContext(XRContext)
  const interactionsValue = React.useContext(InteractionsContext)

  const contextValue = React.useMemo(() => ({ ...xrValue, ...interactionsValue }), [xrValue, interactionsValue])

  return contextValue
}

const useControllers = (group: Group): XRController[] => {
  const gl = useThree(getGl)
  const [controllers, setControllers] = React.useState<XRController[]>([])

  React.useEffect(() => {
    const ids = [0, 1]
    ids.forEach((id) => {
      XRController.make(
        id,
        gl,
        (controller) => {
          group.add(controller.controller)
          group.add(controller.grip)
          group.add(controller.hand)
          setControllers((it) => [...it, controller])
        },
        (controller) => {
          group.remove(controller.controller)
          group.remove(controller.grip)
          group.remove(controller.hand)
          setControllers((existing) => existing.filter((it) => it !== controller))
        }
      )
    })
  }, [gl, group])

  return controllers
}

export function useHitTest(hitTestCallback: (hitMatrix: Matrix4, hit: XRHitTestResult) => void) {
  const gl = useThree(getGl)

  const hitTestSource = React.useRef<XRHitTestSource | undefined>()
  const hitTestSourceRequested = React.useRef(false)
  const [hitMatrix] = React.useState(() => new Matrix4())

  useFrame(() => {
    if (!gl.xr.isPresenting) return

    const session = gl.xr.getSession()
    if (!session) return

    if (!hitTestSourceRequested.current) {
      session.requestReferenceSpace('viewer').then((referenceSpace: XRReferenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source: XRHitTestSource) => {
          hitTestSource.current = source
        })
      })
      session.addEventListener(
        'end',
        () => {
          hitTestSourceRequested.current = false
          hitTestSource.current = undefined
        },
        { once: true }
      )
      hitTestSourceRequested.current = true
    }

    if (hitTestSource.current && gl.xr.isPresenting) {
      const referenceSpace = gl.xr.getReferenceSpace()

      if (referenceSpace) {
        // This raf is unnecesary, we should get XRFrame from r3f but it's not implemented yet
        session.requestAnimationFrame((time: DOMHighResTimeStamp, frame: XRFrame) => {
          const hitTestResults = frame.getHitTestResults(hitTestSource.current as XRHitTestSource)
          if (hitTestResults.length) {
            const hit = hitTestResults[0]
            const pose = hit.getPose(referenceSpace)

            if (pose) {
              hitMatrix.fromArray(pose.transform.matrix)
              hitTestCallback(hitMatrix, hit)
            }
          }
        })
      }
    }
  })
}

export function XR({
  foveation = 0,
  children,
  onSelectMissed
}: {
  foveation?: number
  children: React.ReactNode
  onSelectMissed?: GlobalOnSelectMissed
}) {
  const camera = useThree(getCamera)
  const gl = useThree(getGl)
  const [isPresenting, setIsPresenting] = React.useState(() => gl.xr.isPresenting)
  const [isHandTracking, setHandTracking] = React.useState(false)
  const [player] = React.useState(() => new Group())
  const controllers = useControllers(player)

  React.useEffect(() => {
    const xr = gl.xr

    const handleSessionChange = () => setIsPresenting(xr.isPresenting)

    xr.addEventListener('sessionstart', handleSessionChange)
    xr.addEventListener('sessionend', handleSessionChange)

    return () => {
      xr.removeEventListener('sessionstart', handleSessionChange)
      xr.removeEventListener('sessionend', handleSessionChange)
    }
  }, [gl])

  React.useEffect(() => {
    const xr = gl.xr

    if (xr.setFoveation) {
      xr.setFoveation(foveation)
    }
  }, [gl, foveation])

  React.useEffect(() => {
    const session = gl.xr.getSession()

    const handleInputSourcesChange = (event: Event | XRInputSourceChangeEvent) =>
      setHandTracking(Object.values((event as XRInputSourceChangeEvent).session.inputSources).some((source) => source.hand))

    session?.addEventListener('inputsourceschange', handleInputSourcesChange)

    setHandTracking(Object.values(session?.inputSources ?? []).some((source) => source.hand))

    return () => {
      session?.removeEventListener('inputsourceschange', handleInputSourcesChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresenting])

  const value = React.useMemo(
    () => ({ controllers, isPresenting, isHandTracking, player, onSelectMissed }),
    [controllers, isPresenting, isHandTracking, player, onSelectMissed]
  )

  return (
    <XRContext.Provider value={value}>
      <primitive object={player} dispose={null}>
        <primitive object={camera} dispose={null} />
      </primitive>
      {children}
    </XRContext.Provider>
  )
}

function XRCanvas({
  foveation,
  children,
  onSelectMissed,
  ...rest
}: ContainerProps & { foveation?: number; onSelectMissed?: GlobalOnSelectMissed }) {
  return (
    <Canvas vr {...rest}>
      <XR foveation={foveation} onSelectMissed={onSelectMissed}>
        <InteractionManager>{children}</InteractionManager>
      </XR>
    </Canvas>
  )
}

const createXRButton = (mode: 'AR' | 'VR', gl: any, sessionInit?: any) => {
  const button = mode === 'AR' ? ARButton : VRButton
  const selector = mode === 'AR' ? '#ARButton' : '#VRButton'
  if (document.querySelector(selector) === null) {
    document.body.appendChild(button.createButton(gl, sessionInit))
  }
}

export type XRCanvasProps = ContainerProps & {
  sessionInit?: XRSessionInit
  /**
   * Enables foveated rendering,
   * 0 = no foveation = full resolution,
   * 1 = maximum foveation = the edges render at lower resolution
   */
  foveation?: number
  onSelectMissed?: GlobalOnSelectMissed
}

export function VRCanvas({ children, sessionInit, onCreated, ...rest }: XRCanvasProps) {
  return (
    <XRCanvas
      onCreated={(state) => {
        onCreated?.(state)

        createXRButton('VR', state.gl, sessionInit)
      }}
      {...rest}>
      {children}
    </XRCanvas>
  )
}

export function ARCanvas({ onCreated, children, sessionInit, ...rest }: XRCanvasProps) {
  return (
    <XRCanvas
      onCreated={(state) => {
        onCreated?.(state)

        createXRButton('AR', state.gl, sessionInit)
      }}
      {...rest}>
      {children}
    </XRCanvas>
  )
}

export const useXRFrame = (callback: (time: DOMHighResTimeStamp, xrFrame: XRFrame) => void) => {
  const gl = useThree(getGl)
  const requestRef = React.useRef<number>()
  const previousTimeRef = React.useRef<number>()

  const loop = React.useCallback(
    (time: DOMHighResTimeStamp, xrFrame: XRFrame) => {
      if (previousTimeRef.current !== undefined) {
        callback(time, xrFrame)
      }

      previousTimeRef.current = time
      requestRef.current = gl.xr.getSession()!.requestAnimationFrame(loop)
    },
    [gl.xr, callback]
  )

  React.useEffect(() => {
    if (!gl.xr?.isPresenting) {
      return
    }

    requestRef.current = gl.xr.getSession()!.requestAnimationFrame(loop)

    return () => {
      if (requestRef.current) {
        gl.xr.getSession()!.cancelAnimationFrame(requestRef.current)
      }
    }
  }, [gl.xr.isPresenting, loop, gl.xr])
}

export const useController = (handedness: XRHandedness) => {
  const { controllers } = useXR()
  const controller = React.useMemo(() => controllers.find((it) => it.inputSource.handedness === handedness), [handedness, controllers])

  return controller
}
