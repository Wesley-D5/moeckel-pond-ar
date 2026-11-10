// Depth maps are precomputed from the four original stills using Depth Anything V2 Small.
// The browser only draws a lightweight depth-image-based parallax effect.
const vertexSource = `
attribute vec2 aPosition;
varying vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
const fragmentSource = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uArtwork;
uniform sampler2D uDepth;
uniform vec2 uOffset;
uniform vec2 uCover;
void main() {
  vec2 sourceUV = (vUV - 0.5) * uCover * 0.946 + 0.5;
  vec2 ray = uOffset;
  vec2 uv = sourceUV + ray * 0.5;
  vec2 stepUV = ray / 24.0;
  float layer = 0.0;
  float surface = 1.0 - texture2D(uDepth, uv).r;
  for (int i = 0; i < 24; i++) {
    if (layer >= surface) break;
    uv -= stepUV;
    layer += 1.0 / 24.0;
    surface = 1.0 - texture2D(uDepth, uv).r;
  }
  vec2 previousUV = uv + stepUV;
  float after = surface - layer;
  float before = 1.0 - texture2D(uDepth, previousUV).r - layer + 1.0 / 24.0;
  float weight = clamp(after / min(-0.00001, after - before), 0.0, 1.0);
  vec2 sampleUV = mix(uv, previousUV, weight);
  gl_FragColor = texture2D(uArtwork, clamp(sampleUV, 0.001, 0.999));
}`;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The depth preview could not load.'));
    image.src = url;
  });
}

export function mountParallax({canvas, imageUrl}) {
  let disposed = false;
  let ready = false;
  let frame = 0;
  let lastTime = 0;
  let artwork;
  let program;
  let buffer;
  let observer;
  const textures = [];
  const shaders = [];
  const target = {x: 0, y: 0};
  const position = {x: 0, y: 0};
  canvas.style.opacity = '0';
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, depth: false,
    stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false
  });
  const uniforms = {};
  const schedule = () => {
    if (!frame && ready && !disposed && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const draw = (time) => {
    frame = 0;
    if (!ready || disposed || document.hidden) return;
    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, 1800 / box.width);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 1 / 60;
    lastTime = time;
    const blend = 1 - Math.exp(-dt * 9);
    position.x += (target.x - position.x) * blend;
    position.y += (target.y - position.y) * blend;
    const viewAspect = width / height;
    const imageAspect = artwork.naturalWidth / artwork.naturalHeight;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uCover, Math.min(1, viewAspect / imageAspect), Math.min(1, imageAspect / viewAspect));
    gl.uniform2f(uniforms.uOffset, position.x * 0.028, -position.y * 0.028 * viewAspect);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.style.opacity = '1';
    if (Math.abs(target.x - position.x) + Math.abs(target.y - position.y) > 0.0003) schedule();
  };
  const onVisibility = () => {
    lastTime = 0;
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  };
  const onContextLost = (event) => {
    event.preventDefault();
    dispose();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    ready = false;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.style.opacity = '0';
    if (gl && !gl.isContextLost()) {
      textures.forEach((texture) => gl.deleteTexture(texture));
      shaders.forEach((shader) => gl.deleteShader(shader));
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  const controller = {
    setOffset(x, y) {
      if (disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
      target.x = Math.max(-1, Math.min(1, x));
      target.y = Math.max(-1, Math.min(1, y));
      schedule();
    },
    dispose
  };
  if (!gl) return controller;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('The depth preview shader could not start.');
    return shader;
  };
  const createTexture = (image, unit, name) => {
    const texture = gl.createTexture();
    textures.push(texture);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniforms[name], unit);
  };
  const depthUrl = new URL(imageUrl, document.baseURI);
  const season = depthUrl.pathname.match(/\/(spring|summer|autumn|winter)\.webp$/)?.[1];
  if (!season) return controller;
  depthUrl.pathname = depthUrl.pathname.replace(season + '.webp', season + '-depth.webp');
  Promise.all([loadImage(imageUrl), loadImage(depthUrl.href)]).then(([image, depth]) => {
    if (disposed) return;
    artwork = image;
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('The depth preview could not start.');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['uArtwork','uDepth','uOffset','uCover']) uniforms[name] = gl.getUniformLocation(program, name);
    createTexture(image, 0, 'uArtwork');
    createTexture(depth, 1, 'uDepth');
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onContextLost);
    observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    ready = true;
    schedule();
  }).catch(dispose);
  return controller;
}
