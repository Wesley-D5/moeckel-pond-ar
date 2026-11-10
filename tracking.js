// 8th Wall XR Engine by Niantic Spatial, Inc. © 2026. See tracking/engine/LICENSE.
import {measureWall} from './tracking/wall-fit.js'

const asset = (path) => new URL('./tracking/' + path, import.meta.url)
const ASPECT = 9 / 16
const FALLBACK_DISTANCE = 1.5 // metres in front when a wall can't be measured
let runtime
let current

function engine() {
  if (window.XR8) return Promise.resolve(window.XR8)
  if (!runtime) {
    runtime = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      const done = (error) => {
        clearTimeout(timeout)
        window.removeEventListener('xrloaded', loaded)
        script.onerror = null
        if (error) {
          script.remove()
          reject(error)
        } else {
          resolve(window.XR8)
        }
      }
      const loaded = () => { if (window.XR8) done() }
      const timeout = setTimeout(() => done(new Error('The AR engine took too long to load. Check your connection and try again.')), 90000)
      window.addEventListener('xrloaded', loaded, {once: true})
      script.async = true
      script.src = asset('engine/xr.js').href
      script.dataset.preloadChunks = 'slam'
      script.crossOrigin = 'anonymous'
      script.onerror = () => done(new Error('The AR engine could not load. Check your connection and try again.'))
      document.head.append(script)
    }).catch((error) => { runtime = null; throw error })
  }
  return runtime
}

async function readTarget() {
  const url = asset('target/poster.json')
  const response = await fetch(url)
  if (!response.ok) throw new Error('The print tracking file could not load. Try again.')
  const target = await response.json()
  target.imagePath = new URL(target.imagePath, url).href
  return target
}

function askMotion() {
  // WebKit consumes the tap before the (potentially uncached) runtime has loaded.
  const permissions = [window.DeviceMotionEvent, window.DeviceOrientationEvent]
    .filter((type) => typeof type?.requestPermission === 'function')
    .map((type) => type.requestPermission().catch(() => 'denied'))
  return Promise.all(permissions).then((results) => results.every((value) => value === 'granted'))
}

export function startTracking({mode, canvas, video, posterUrl, onStatus = () => {}, onError = () => {}}) {
  current?.stop()
  const scan = mode === 'scan'
  let stopped = false, running = false, ownsEngine = false, visible = false
  let xr, THREE, scene, camera, mesh, frame, material, stillTexture, filmTexture
  let width = 0.9, state = '', message = '', stream, startTimer
  let world = false, worldGood = false, acquired = false, lastImage = 0, lostAt = null
  let candidate = null, stable = 0, measuredAt = -Infinity, isPlaced = false
  let resolveReady, rejectReady
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej })
  ready.catch(() => {}) // onError is also a supported notification route.
  const status = (next, text) => {
    if (stopped || (state === next && message === text)) return
    state = next
    message = text
    onStatus(next, text)
  }
  const scanHint = 'Fit the printed artwork in view. Keep the mill and shoreline visible.'
  const wallHint = 'Aim at a textured wall and move slowly from side to side.'
  const setMedia = (show) => {
    if (show === visible) return
    visible = show
    if (show) {
      video.play().catch(() => {
        if (!stopped && visible && !video.muted) {
          video.muted = true
          video.play().catch(() => {})
        }
      })
    } else video.pause()
  }
  const resize = () => {
    if (stopped) return
    const box = canvas.parentElement?.getBoundingClientRect()
    const cssWidth = box?.width || window.innerWidth
    const cssHeight = box?.height || window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5, 1440 / Math.max(cssWidth, cssHeight))
    const w = Math.max(1, Math.round(cssWidth * dpr))
    const h = Math.max(1, Math.round(cssHeight * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    canvas.style.setProperty('width', '100%', 'important')
    canvas.style.setProperty('height', '100%', 'important')
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(startTimer)
    window.removeEventListener('resize', resize)
    window.visualViewport?.removeEventListener('resize', resize)
    window.removeEventListener('pagehide', stop)
    if (ownsEngine) {
      try { xr.stop() } catch {}
      try { xr.clearCameraPipelineModules() } catch {}
    }
    stream?.getTracks().forEach((track) => track.stop())
    if (mesh) {
      scene?.remove(mesh)
      mesh.geometry.dispose()
      material.dispose()
      frame?.geometry.dispose()
      frame?.material.dispose()
      stillTexture.dispose()
      filmTexture.dispose()
    }
    video.pause()
    if (current === controller) current = null
    rejectReady(new DOMException('Camera session closed.', 'AbortError'))
  }
  const fail = (error) => {
    if (stopped) return
    const reason = error instanceof Error ? error : new Error(String(error || 'The camera could not start.'))
    rejectReady(reason)
    stop()
    onError(reason)
  }
  const reset = () => {
    if (stopped || !mesh) return
    isPlaced = false
    acquired = false
    lostAt = null
    stable = 0
    candidate = null
    mesh.visible = false
    setMedia(false)
    status(scan ? 'scanning' : 'searching', scan ? scanHint : wallHint)
  }
  const setOpacity = (value) => {
    material.opacity = value
    if (frame) { frame.material.transparent = value < 1; frame.material.opacity = value }
  }
  const place = () => {
    // Placement always works once the camera runs: it locks the live preview where it is,
    // on the measured wall if one was found, otherwise at a fixed distance in front.
    if (stopped || scan || !mesh || isPlaced || !mesh.visible) return false
    mesh.scale.setScalar(width)
    setOpacity(1)
    isPlaced = true
    setMedia(true)
    status('placed', 'Artwork placed on the wall.')
    return true
  }
  const setSize = (value) => {
    if (scan || !Number.isFinite(value)) return
    width = Math.max(0.2, Math.min(2.4, value))
    if (isPlaced) mesh.scale.setScalar(width)
  }
  const controller = {ready, stop, place, reset, setSize}
  current = controller

  const showImage = ({detail}) => {
    if (stopped || !mesh || detail.name !== 'poster') return
    const now = performance.now()
    // The tracker describes the central 4:3 crop. Its height equals the full print height.
    const size = detail.scale * detail.scaledHeight / ASPECT
    if (!(size > 0)) return
    const rotation = new THREE.Quaternion().copy(detail.rotation).normalize()
    const snap = !acquired || !mesh.visible || mesh.position.distanceTo(detail.position) > size * 0.28 ||
      mesh.quaternion.angleTo(rotation) > 0.55
    const dt = Math.min(0.1, Math.max(1 / 120, (now - lastImage) / 1000))
    // Filter small pose noise. Follow a moving or reacquired print without dragging behind.
    const movement = mesh.position.distanceTo(detail.position) / size + mesh.quaternion.angleTo(rotation) * 0.18
    const gain = snap ? 1 : 1 - Math.exp(-dt * (18 + Math.min(80, movement * 850)))
    mesh.position.lerp(detail.position, gain)
    mesh.quaternion.slerp(rotation, gain)
    mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, size, gain))
    mesh.visible = true
    material.opacity = 1
    acquired = true
    lostAt = null
    lastImage = now
    setMedia(true)
    status('tracking', 'Print in view.')
  }
  const loseImage = ({detail}) => {
    if (stopped || detail.name !== 'poster' || !acquired || lostAt !== null) return
    lostAt = performance.now()
  }
  const onUpdate = ({processCpuResult}) => {
    if (!running || stopped || !mesh) return
    const now = performance.now()
    const reality = processCpuResult?.reality
    worldGood = world && reality?.trackingStatus === 'NORMAL'
    // A still remains visible while the first video frame is being decoded.
    if (!video.paused && video.readyState >= 2 && material.map !== filmTexture) {
      material.map = filmTexture
      material.needsUpdate = true
    }
    if (scan) {
      if (lostAt === null) return
      const elapsed = now - lostAt
      const hold = worldGood ? 430 : 0
      material.opacity = Math.max(0, 1 - Math.max(0, elapsed - hold) / 220)
      if (elapsed >= hold + 220) {
        acquired = false
        lostAt = null
        mesh.visible = false
        setMedia(false)
        status('lost', 'Bring the printed artwork back into view.')
      }
      return
    }
    if (isPlaced) {
      mesh.visible = true
      setMedia(true)
      status('placed', 'Artwork placed on the wall.')
      return
    }
    // Measure the wall from tracked feature points when possible (about 10 times a second).
    if (worldGood && now - measuredAt >= 95) {
      measuredAt = now
      const wall = measureWall(THREE, camera, reality.worldPoints)
      if (wall && candidate && wall.normal.dot(candidate.normal) > 0.95 &&
          Math.abs(wall.position.clone().sub(candidate.position).dot(candidate.normal)) < 0.07) {
        wall.normal.lerp(candidate.normal, 0.45).normalize()
        wall.at = now
        stable++
        candidate = wall
      } else if (wall) {
        wall.at = now
        stable = 1
        candidate = wall
      } else if (now - (candidate?.at || 0) > 600) {
        stable = 0
        candidate = null
      }
    }
    // Live preview: on the measured wall, or 1.5 m straight ahead when the wall has too
    // little texture to measure. Either way the artwork shows and can be placed.
    const measured = Boolean(candidate && stable >= 2)
    let position, normal
    if (measured) {
      position = candidate.position.clone()
      normal = candidate.normal.clone()
    } else {
      const direction = camera.getWorldDirection(new THREE.Vector3())
      position = camera.position.clone().addScaledVector(direction, FALLBACK_DISTANCE)
      normal = direction.negate()
      normal.y = 0
      if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1)
      normal.normalize()
    }
    position.addScaledVector(normal, 0.005)
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(normal.x, normal.z), 0))
    if (!mesh.visible) {
      mesh.position.copy(position)
      mesh.quaternion.copy(target)
    } else {
      mesh.position.lerp(position, 0.3)
      mesh.quaternion.slerp(target, 0.3)
    }
    mesh.scale.setScalar(width)
    mesh.visible = true
    setOpacity(0.6)
    status('wall-ready', measured ? 'Wall found. Tap Place here.' : 'Point at your wall, then tap Place here.')
  }
  const setupScene = () => {
    if (stopped) return
    ;({scene, camera} = xr.Threejs.xrScene())
    camera.position.set(0, world ? 1.5 : 0, 0)
    xr.XrController.updateCameraProjectionMatrix({origin: camera.position, facing: camera.quaternion})
    stillTexture = new THREE.TextureLoader().load(posterUrl)
    filmTexture = new THREE.VideoTexture(video)
    stillTexture.colorSpace = filmTexture.colorSpace = THREE.SRGBColorSpace
    material = new THREE.MeshBasicMaterial({map: stillTexture, toneMapped: false, transparent: true})
    // Draw the artwork just in front of its frame even while the preview is see-through.
    Object.assign(material, {polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4})
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, ASPECT), material)
    if (!scan) {
      frame = new THREE.Mesh(new THREE.BoxGeometry(1.024, ASPECT + 0.024, 0.017), new THREE.MeshBasicMaterial({color: 0x2b2118}))
      frame.position.z = -0.009
      mesh.add(frame)
    }
    mesh.visible = false
    scene.add(mesh)
    resize()
    running = true
    clearTimeout(startTimer)
    status(scan ? 'scanning' : 'searching', scan ? scanHint : wallHint)
    resolveReady()
  }

  const launch = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access requires a secure browser window. Open this experience directly in Safari or Chrome.')
    }
    status('loading', 'Preparing the camera and motion tracking…')
    const [motion, library, sdk, target] = await Promise.all([
      scan ? false : askMotion(), import('./tracking/three/three.module.js'), engine(), scan ? readTarget() : null
    ])
    if (stopped) return
    THREE = library
    window.THREE = THREE
    xr = sdk
    if (!xr.XrController) await xr.loadChunk('slam')
    await xr.initialize()
    if (stopped) return
    const devices = xr.XrConfig.device()
    world = motion && xr.XrDevice.isDeviceBrowserCompatible({allowedDevices: devices.MOBILE})
    if (!scan && !world) {
      throw new Error(motion ? 'Wall tracking needs a phone or tablet with motion sensors.' : 'Allow Motion & Orientation access in your browser settings to place the artwork.')
    }
    // A permission failure inside XR8.run leaves the SDK's startup configuration locked.
    // Request access first so denial, cancellation, and a disconnected camera are retryable.
    status('loading', 'Allow camera access to begin.')
    const permissionStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {facingMode: {ideal: 'environment'}}
    })
    permissionStream.getTracks().forEach((track) => track.stop())
    if (stopped) return
    xr.clearCameraPipelineModules()
    ownsEngine = true
    xr.XrController.configure({
      disableWorldTracking: !world,
      enableWorldPoints: !scan,
      scale: 'responsive', // no calibration walk needed before tracking starts
      imageTargetData: scan ? [target] : []
    })
    xr.Threejs.configure({renderCameraTexture: false})
    resize()
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    window.addEventListener('pagehide', stop)
    xr.addCameraPipelineModules([
      xr.GlTextureRenderer.pipelineModule(),
      xr.Threejs.pipelineModule(),
      xr.XrController.pipelineModule(),
      {
        name: 'moeckel-pond',
        onStart: setupScene,
        onUpdate,
        onPaused: () => {
          worldGood = false
          candidate = null
          stable = 0
          if (mesh) mesh.visible = false
          if (scan) { acquired = false; lostAt = null }
          setMedia(false)
          status('recovering', 'Return to the camera to continue.')
        },
        onException: (error) => queueMicrotask(() => fail(error)),
        onCameraStatusChange: (event) => {
          if (event.stream) stream = event.stream
          if (event.status === 'requesting') status('loading', 'Allow camera access to begin.')
          if (event.status === 'failed') queueMicrotask(() => fail(new Error('The camera could not open. Check camera permissions, close other camera apps and try again.')))
        },
        onDeviceOrientationChange: resize,
        listeners: scan ? [
          {event: 'reality.imagefound', process: showImage},
          {event: 'reality.imageupdated', process: showImage},
          {event: 'reality.imagelost', process: loseImage}
        ] : []
      }
    ])
    startTimer = setTimeout(() => fail(new Error('The camera did not start. Check permission and try again.')), 90000)
    xr.run({canvas, allowedDevices: world ? devices.MOBILE : devices.ANY,
      sessionConfiguration: {disableDesktopCameraControls: true}})
  }
  launch().catch(fail)
  return controller
}
