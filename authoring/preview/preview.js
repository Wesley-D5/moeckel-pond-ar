// Three.js r183 and its loaders are bundled locally. See LICENSE-three.txt.
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

function freeModel(root) {
  if (!root) return;
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      for (const material of [].concat(object.material)) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) textures.add(value);
      }
    }
  });
  textures.forEach((texture) => {
    texture.dispose();
    texture.image?.close?.();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export function mountPreview({
  container,
  modelUrl = new URL("./mill-study.glb", import.meta.url),
  onReady,
  onError,
  playing = !matchMedia("(prefers-reduced-motion: reduce)").matches,
}) {
  const request = new AbortController();
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "3D tabletop artwork. Drag or use the arrow keys to orbit. Use plus and minus to zoom.",
  );
  canvas.style.cssText =
    "position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px;";
  const scene = new Scene(),
    camera = new PerspectiveCamera(37, 1, 0.001, 10);
  const center = new Vector3(),
    defaultDirection = new Vector3(-0.055, 0.035, 1).normalize();
  let authoredView;
  let renderer,
    controls,
    mixer,
    model,
    environment,
    shadow,
    keyLight,
    sizeObserver,
    visibilityObserver;
  let frame = 0,
    lastTime = 0,
    radius = 0.2,
    frameDistance = 0;
  let disposed = false,
    loaded = false,
    onscreen = true,
    resolved = false;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  function dispose() {
    if (disposed) return;
    disposed = true;
    request.abort();
    cancelAnimationFrame(frame);
    sizeObserver?.disconnect();
    visibilityObserver?.disconnect();
    controls?.removeEventListener("change", schedule);
    controls?.dispose();
    document.removeEventListener("visibilitychange", visibilityChanged);
    canvas.removeEventListener("keydown", keydown);
    canvas.removeEventListener("webglcontextlost", contextLost);
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    }
    freeModel(model);
    shadow?.geometry.dispose();
    shadow?.material.dispose();
    keyLight?.shadow.dispose();
    environment?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove();
    if (!resolved)
      rejectReady(new DOMException("Preview closed.", "AbortError"));
  }
  function fail(error) {
    if (disposed) return;
    rejectReady(error);
    dispose();
    onError?.(error);
  }
  function contextLost(event) {
    event.preventDefault();
    fail(new Error("The 3D view was interrupted."));
  }
  function schedule() {
    if (!frame && loaded && !disposed && onscreen && !document.hidden)
      frame = requestAnimationFrame(draw);
  }
  function visibilityChanged() {
    if (!onscreen || document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    } else schedule();
  }
  function draw(time) {
    frame = 0;
    if (disposed || !loaded || !onscreen || document.hidden) return;
    const dt = lastTime ? Math.max(0, (time - lastTime) / 1000) : 1 / 60;
    if (lastTime && dt < 1 / 32) {
      schedule();
      return;
    }
    lastTime = time;
    if (playing) mixer?.update(Math.min(dt, 0.1));
    const moved = controls.update(Math.min(dt, 0.1));
    renderer.render(scene, camera);
    if (playing || moved) schedule();
  }
  function resize() {
    if (!renderer || !model || disposed) return;
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    const previousDistance = frameDistance;
    const verticalFov = (camera.fov * Math.PI) / 180;
    const limitingFov = Math.min(
      verticalFov,
      2 * Math.atan(Math.tan(verticalFov / 2) * aspect),
    );
    frameDistance = (radius / Math.sin(limitingFov * 0.5)) * 0.65;
    if (authoredView) {
      const tangent = Math.max(
        authoredView.tanY / 0.88,
        authoredView.tanX / (aspect * 0.915),
      );
      camera.fov = (2 * Math.atan(tangent) * 180) / Math.PI;
      frameDistance = new Vector3(...authoredView.eye).distanceTo(center);
    }
    camera.aspect = aspect;
    camera.near = Math.max(0.0003, radius * 0.012);
    camera.far = radius * 75;
    camera.updateProjectionMatrix();
    const ratio = Math.min(
      1.7,
      window.devicePixelRatio || 1,
      1800 / Math.max(width, height),
    );
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    controls.minDistance = frameDistance * 0.52;
    controls.maxDistance = frameDistance * 2.1;
    if (previousDistance) {
      const relative = camera.position
        .clone()
        .sub(controls.target)
        .multiplyScalar(frameDistance / previousDistance);
      camera.position.copy(controls.target).add(relative);
    } else resetView();
    schedule();
  }
  function resetView() {
    if (!controls || disposed) return;
    controls.target.copy(center);
    camera.position
      .copy(center)
      .addScaledVector(defaultDirection, frameDistance);
    controls.update();
    schedule();
  }
  function keydown(event) {
    const keys = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "+",
      "=",
      "-",
      "Home",
    ];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      resetView();
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    if (event.key.startsWith("Arrow")) {
      const theta =
        Math.atan2(offset.x, offset.z) +
        (event.key === "ArrowLeft"
          ? -0.13
          : event.key === "ArrowRight"
            ? 0.13
            : 0);
      const polar = Math.max(
        controls.minPolarAngle,
        Math.min(
          controls.maxPolarAngle,
          Math.acos(offset.y / offset.length()) +
            (event.key === "ArrowUp"
              ? -0.09
              : event.key === "ArrowDown"
                ? 0.09
                : 0),
        ),
      );
      offset.setFromSphericalCoords(offset.length(), polar, theta);
    } else
      offset.setLength(
        Math.min(
          controls.maxDistance,
          Math.max(
            controls.minDistance,
            offset.length() * (event.key === "-" ? 1.1 : 1 / 1.1),
          ),
        ),
      );
    camera.position.copy(controls.target).add(offset);
    controls.update();
    schedule();
  }

  async function load() {
    const url = new URL(modelUrl, document.baseURI);
    const response = await fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error("The 3D artwork could not load.");
    const bytes = await response.arrayBuffer();
    if (disposed) return;
    const gltf = await new GLTFLoader().parseAsync(
      bytes,
      new URL(".", url).href,
    );
    if (disposed) {
      freeModel(gltf.scene);
      return;
    }
    model = gltf.scene;
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    radius = Math.max(0.01, 0.5 * size.length());
    box.getCenter(center);
    center.y -= size.y * 0.12;
    authoredView = model.userData.hero;
    if (authoredView) {
      center.set(...authoredView.target);
      defaultDirection
        .set(...authoredView.eye)
        .sub(center)
        .normalize();
    }
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setClearColor(new Color("#ffffff"), 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.93;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    const room = new RoomEnvironment(),
      pmrem = new PMREMGenerator(renderer);
    try {
      environment = pmrem.fromScene(room, 0, 0.1, 100, { size: 64 });
    } finally {
      pmrem.dispose();
      room.dispose();
    }
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.48;
    scene.add(new HemisphereLight(0xfff9ec, 0x9da79f, 0.82));
    keyLight = new DirectionalLight(0xfff5da, 2.3);
    keyLight.position
      .copy(center)
      .add(new Vector3(-3, 5, 4).multiplyScalar(radius));
    keyLight.target.position.copy(center);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    keyLight.shadow.radius = 3.5;
    Object.assign(keyLight.shadow.camera, {
      left: -radius * 1.6,
      right: radius * 1.6,
      top: radius * 1.6,
      bottom: -radius * 1.6,
      near: radius,
      far: radius * 12,
    });
    keyLight.shadow.normalBias = radius * 0.002;
    keyLight.shadow.bias = -0.00015;
    scene.add(keyLight, keyLight.target);
    shadow = new Mesh(
      new PlaneGeometry(radius * 10, radius * 10),
      new ShadowMaterial({ opacity: 0.1, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(center.x, box.min.y - radius * 0.002, center.z);
    shadow.receiveShadow = true;
    scene.add(shadow, model);
    model.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    if (gltf.animations.length) {
      mixer = new AnimationMixer(model);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    }
    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.105;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.65;
    controls.minPolarAngle = Math.PI * 0.065;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.addEventListener("change", schedule);
    canvas.addEventListener("keydown", keydown);
    canvas.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", visibilityChanged);
    sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(container);
    if (typeof IntersectionObserver === "function") {
      visibilityObserver = new IntersectionObserver(([entry]) => {
        onscreen = entry.isIntersecting;
        visibilityChanged();
      });
      visibilityObserver.observe(container);
    }
    resize();
    renderer.render(scene, camera);
    container.append(canvas);
    loaded = true;
    resolved = true;
    resolveReady();
    onReady?.();
    schedule();
  }
  load().catch(fail);
  return {
    ready,
    dispose,
    resetView,
    setPlaying(value) {
      playing = !!value;
      lastTime = 0;
      schedule();
    },
  };
}
