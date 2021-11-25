import React, { useRef, useEffect, ReactNode, useMemo, useContext, forwardRef, useCallback } from 'react'
import { XRContext } from './context'
import { Object3D, Group, Matrix4, Raycaster, Intersection, XRHandedness } from 'three'
import { useFrame } from '@react-three/fiber'
import { XRController } from './XRController'
import { ObjectsState } from './ObjectsState'
import mergeRefs from 'react-merge-refs'
import { useXREvent, XREvent } from './XREvents'

/* @__PURE__ */ const tempMatrix = new Matrix4()
// /* @__PURE__ */ const prevControllerMatrix = new Matrix4()

export interface XRInteractionBaseEvent {
  eventObject: Object3D
  intersections: Intersection[]
  controller: XRController
}

export interface XRInteractionWithIntersectionEvent extends XRInteractionBaseEvent {
  intersection: Intersection
  stopped: boolean
  stopPropagation: () => void
}
export interface XRInteractionNoIntersectionEvent extends XRInteractionBaseEvent {
  intersection?: undefined
  stopped?: undefined
  stopPropagation?: undefined
}

export type XRInteractionEvent = XRInteractionWithIntersectionEvent | XRInteractionNoIntersectionEvent

const warnIfNoContext = () => console.warn('No react-xr InteractionContext found')

export type XRInteractionWithIntersectionType =
  | 'onHover'
  | 'onSelectStart'
  | 'onSelectEnd'
  | 'onSelect'
  | 'onSqueeze'
  | 'onSqueezeEnd'
  | 'onSqueezeStart'

export type XRInteractionNoIntersectionType = 'onBlur' | 'onSelectMissed'

export type XRInteractionType = XRInteractionWithIntersectionType | XRInteractionNoIntersectionType

export type XRInteractionWithIntersectionHandler = (event: XRInteractionWithIntersectionEvent) => void
export type XRInteractionNoIntersectionHandler = (event: XRInteractionNoIntersectionEvent) => void
export type XRInteractionHandler = (event: XRInteractionEvent) => void

export const InteractionsContext = React.createContext<{
  hoverState: Record<XRHandedness, Map<Object3D, XRInteractionWithIntersectionEvent>>
  addInteraction: (object: Object3D, eventType: XRInteractionType, handler: XRInteractionHandler) => any
  removeInteraction: (object: Object3D, eventType: XRInteractionType, handler: XRInteractionHandler) => any
  raycaster: Raycaster
  hoverClosest: Record<XRHandedness, Intersection | undefined>
}>({
  hoverState: {} as any,
  addInteraction: warnIfNoContext,
  removeInteraction: warnIfNoContext,
  raycaster: null as any,
  hoverClosest: {} as any
})

export function InteractionManager({ children }: { children: any }) {
  const { controllers, onSelectMissed: onSelectMissedGlobal } = React.useContext(XRContext)

  const [hoverState] = React.useState<Record<XRHandedness, Map<Object3D, XRInteractionWithIntersectionEvent>>>(() => ({
    left: new Map(),
    right: new Map(),
    none: new Map()
  }))

  const [hoverClosest] = React.useState<Record<XRHandedness, Intersection | undefined>>({
    left: undefined,
    right: undefined,
    none: undefined
  })

  const [interactions] = React.useState(() => ObjectsState.make<XRInteractionType, XRInteractionHandler>())

  const addInteraction = React.useCallback(
    (object: Object3D, eventType: XRInteractionType, handler: XRInteractionHandler) => {
      ObjectsState.add(interactions, object, eventType, handler)
    },
    [interactions]
  )

  const removeInteraction = React.useCallback(
    (object: Object3D, eventType: XRInteractionType, handler: XRInteractionHandler) => {
      ObjectsState.delete(interactions, object, eventType, handler)

      if (!interactions.has(object)) {
        hoverState.left.delete(object)
        hoverState.right.delete(object)
        hoverState.none.delete(object)
      }

      if (hoverClosest.left?.object === object) {
        hoverClosest.left = undefined
      }

      if (hoverClosest.right?.object === object) {
        hoverClosest.right = undefined
      }

      if (hoverClosest.none?.object === object) {
        hoverClosest.none = undefined
      }
    },
    [hoverClosest, hoverState.left, hoverState.none, hoverState.right, interactions]
  )
  const [raycaster] = React.useState(() => new Raycaster())

  const raycast = React.useCallback(
    (controller: Object3D) => {
      const objects = Array.from(interactions.keys())
      tempMatrix.identity().extractRotation(controller.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)

      return raycaster.intersectObjects(objects, true)
    },
    [interactions, raycaster]
  )

  const getIntersections = useCallback(
    (xrController: XRController): [Intersection[], Object3D[], Set<string>] => {
      const hitsSet = new Set<string>()

      if (interactions.size === 0) {
        return [[], [], hitsSet]
      }

      const { controller } = xrController
      const intersects = raycast(controller)

      const intersections: Intersection[] = []
      const eventObjects: Object3D[] = []

      for (const intersect of intersects) {
        let eventObject: Object3D | null = intersect.object

        while (eventObject) {
          if (interactions.has(eventObject)) {
            intersections.push(intersect)
            eventObjects.push(eventObject)
            hitsSet.add(eventObject.uuid)
          }
          eventObject = eventObject.parent
        }
      }

      return [intersections, eventObjects, hitsSet]
    },
    [interactions, raycast]
  )

  const cancelHover = useCallback(
    (
      hits: Intersection[],
      hovering: Map<Object3D, XRInteractionEvent>,
      handedness: XRHandedness,
      hoverClosest: Record<XRHandedness, Intersection | undefined>,
      hitsSet: Set<string>,
      xrController: XRController
    ) => {
      for (const eventObject of hovering.keys()) {
        if (!hitsSet.has(eventObject.uuid)) {
          ObjectsState.get(interactions, eventObject, 'onBlur')?.forEach((handler) =>
            handler({ eventObject, controller: xrController, intersections: hits })
          )
          hovering.delete(eventObject)
          if (hoverClosest[handedness]?.object === eventObject) {
            hoverClosest[handedness] = undefined
          }
        }
      }
    },
    [interactions]
  )

  const handleIntersects = useCallback(
    (
      intersections: Intersection[],
      eventObjects: Object3D[],
      xrController: XRController,
      hovering: Map<Object3D, XRInteractionEvent>,
      handedness: XRHandedness,
      hoverClosest: Record<XRHandedness, Intersection | undefined>,
      hitsSet: Set<string>,
      callback: (event: XRInteractionWithIntersectionEvent) => void
    ) => {
      if (!intersections.length) {
        return [intersections, eventObjects]
      }

      let stopped = false

      for (let i = 0; i < intersections.length; i++) {
        const hit = intersections[i]
        const eventObject = eventObjects[i]
        const event: XRInteractionWithIntersectionEvent = {
          eventObject,
          controller: xrController,
          intersection: hit,
          intersections,
          stopped,
          stopPropagation: () => {
            event.stopped = stopped = true
            if (interactions.size && hovering.has(eventObject)) {
              cancelHover(intersections.slice(0, i + 1), hovering, handedness, hoverClosest, hitsSet, xrController)
            }
          }
        }

        callback(event)

        if (stopped) {
          break
        }
      }

      return [intersections, eventObjects]
    },
    [cancelHover, interactions.size]
  )

  // Trigger hover and blur events
  useFrame(() => {
    if (interactions.size === 0) {
      return
    }

    controllers.forEach((xrController) => {
      const [hits, eventObjects, hitsSet] = getIntersections(xrController)

      const handedness = xrController.inputSource.handedness
      const hovering = hoverState[handedness]

      hoverClosest[handedness] = hits[0] ?? undefined

      // Trigger blur on all the object that were hovered in the previous frame
      // but missed in this one
      cancelHover(hits, hovering, handedness, hoverClosest, hitsSet, xrController)

      handleIntersects(hits, eventObjects, xrController, hovering, handedness, hoverClosest, hitsSet, (event) => {
        const { eventObject } = event
        const hoverEvent = hovering.get(eventObject)
        if (!hoverEvent) {
          hovering.set(eventObject, event)
          if (ObjectsState.has(interactions, eventObject, 'onHover')) {
            ObjectsState.get(interactions, eventObject, 'onHover')?.forEach((handler) => handler(event))
          }
        } else if (hoverEvent.stopped) {
          event.stopPropagation()
        }
      })
    })
  })

  const triggerEvent = (interaction: XRInteractionType) => (e: XREvent) => {
    const { controller: xrController } = e
    const [hits, eventObjects, hitsSet] = getIntersections(xrController)
    const handedness = xrController.inputSource.handedness
    const hovering = hoverState[handedness]

    if (interaction === 'onSelect') {
      for (const [eventObject, entry] of interactions.entries()) {
        const handlers = entry['onSelectMissed']
        if (!hitsSet.has(eventObject.uuid) && handlers) {
          handlers.forEach((handler) =>
            handler({
              controller: xrController,
              eventObject,
              intersections: hits
            })
          )
        }
      }

      if (onSelectMissedGlobal && hitsSet.size === 0) {
        onSelectMissedGlobal({
          controller: xrController,
          intersections: hits
        })
      }
    }

    handleIntersects(hits, eventObjects, xrController, hovering, handedness, hoverClosest, hitsSet, (event) => {
      const { eventObject } = event
      ObjectsState.get(interactions, eventObject, interaction)?.forEach((handler) => handler(event))
    })
  }

  useXREvent('select', triggerEvent('onSelect'))
  useXREvent('selectstart', triggerEvent('onSelectStart'))
  useXREvent('selectend', triggerEvent('onSelectEnd'))
  useXREvent('squeeze', triggerEvent('onSqueeze'))
  useXREvent('squeezeend', triggerEvent('onSqueezeEnd'))
  useXREvent('squeezestart', triggerEvent('onSqueezeStart'))

  const contextValue = useMemo(
    () => ({ addInteraction, removeInteraction, hoverState, raycaster, hoverClosest }),
    [addInteraction, removeInteraction, hoverState, raycaster, hoverClosest]
  )

  return <InteractionsContext.Provider value={contextValue}>{children}</InteractionsContext.Provider>
}

export function useInteraction(
  ref: React.RefObject<Object3D>,
  type: XRInteractionWithIntersectionType,
  handler?: XRInteractionWithIntersectionHandler
): void
export function useInteraction(
  ref: React.RefObject<Object3D>,
  type: XRInteractionNoIntersectionType,
  handler?: XRInteractionNoIntersectionHandler
): void
export function useInteraction(
  ref: React.RefObject<Object3D>,
  type: XRInteractionWithIntersectionType | XRInteractionNoIntersectionType,
  handler?: XRInteractionWithIntersectionHandler | XRInteractionNoIntersectionHandler
): void {
  const { addInteraction, removeInteraction } = useContext(InteractionsContext)

  const isPresent = handler !== undefined
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!isPresent || !ref.current) return

    const handlerFn = (e: XRInteractionEvent) => {
      // @ts-ignore
      handlerRef.current(e)
    }

    addInteraction(ref.current, type, handlerFn)
    const maybeRef = ref.current

    return () => removeInteraction(maybeRef, type, handlerFn)
  }, [type, addInteraction, removeInteraction, isPresent, ref])
}

export const Interactive = forwardRef(
  (
    props: {
      children: ReactNode
      onHover?: XRInteractionWithIntersectionHandler
      onBlur?: XRInteractionNoIntersectionHandler
      onSelectStart?: XRInteractionWithIntersectionHandler
      onSelectEnd?: XRInteractionWithIntersectionHandler
      onSelect?: XRInteractionWithIntersectionHandler
      onSqueezeStart?: XRInteractionWithIntersectionHandler
      onSqueezeEnd?: XRInteractionWithIntersectionHandler
      onSqueeze?: XRInteractionWithIntersectionHandler
      onSelectMissed?: XRInteractionNoIntersectionHandler
    },
    passedRef
  ) => {
    const ref = useRef<Object3D>(null)

    useInteraction(ref, 'onHover', props.onHover)
    useInteraction(ref, 'onBlur', props.onBlur)
    useInteraction(ref, 'onSelectStart', props.onSelectStart)
    useInteraction(ref, 'onSelectEnd', props.onSelectEnd)
    useInteraction(ref, 'onSelect', props.onSelect)
    useInteraction(ref, 'onSqueezeStart', props.onSqueezeStart)
    useInteraction(ref, 'onSqueezeEnd', props.onSqueezeEnd)
    useInteraction(ref, 'onSqueeze', props.onSqueeze)
    useInteraction(ref, 'onSelectMissed', props.onSelectMissed)

    return <group ref={mergeRefs([passedRef, ref])}>{props.children}</group>
  }
)

export function RayGrab({ children }: { children: ReactNode }) {
  const grabbingController = useRef<Object3D>()
  const groupRef = useRef<Group>()
  const previousTransform = useRef<Matrix4 | undefined>(undefined)

  useXREvent('selectend', (e) => {
    if (e.controller.controller === grabbingController.current) {
      grabbingController.current = undefined
      previousTransform.current = undefined
    }
  })

  useFrame(() => {
    if (!grabbingController.current || !previousTransform.current || !groupRef.current) {
      return
    }

    const controller = grabbingController.current
    const group = groupRef.current

    group.applyMatrix4(previousTransform.current)
    group.applyMatrix4(controller.matrixWorld)
    group.updateWorldMatrix(false, true)

    previousTransform.current = controller.matrixWorld.clone().invert()
  })

  return (
    <Interactive
      ref={groupRef}
      onSelectStart={(e) => {
        grabbingController.current = e.controller.controller
        previousTransform.current = e.controller.controller.matrixWorld.clone().invert()
      }}>
      {children}
    </Interactive>
  )
}
