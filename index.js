const RESOLUTION = 64 // px
const BYTE = WebGLRenderingContext.BYTE
const UNSIGNED_BYTE = WebGLRenderingContext.UNSIGNED_BYTE
const BYTE_SIZE = Int8Array.BYTES_PER_ELEMENT
const UNSIGNED_BYTE_SIZE = Uint8Array.BYTES_PER_ELEMENT
const ATTRIB_LAYOUT = { // Must match shader and buffer layouts.
  vert: {
    stride: 2,
    uv: {
      location: 0,
      type: BYTE,
      size: BYTE_SIZE,
      length: 2,
      stride: 2,
      offset: 0,
      divisor: 0,
    },
  },
  instance: {
    stride: 9,
    texCoord: {
      location: 1,
      type: BYTE,
      size: BYTE_SIZE,
      length: 4,
      stride: 9,
      offset: 0,
      divisor: 1,
    },
    scale: {
      location: 2,
      type: BYTE,
      size: BYTE_SIZE,
      length: 2,
      stride: 9,
      offset: 4,
      divisor: 1,
    },
    minusAlpha: {
      location: 3,
      type: UNSIGNED_BYTE,
      size: UNSIGNED_BYTE_SIZE,
      length: 1,
      stride: 9,
      offset: 6,
      divisor: 1,
    },
    position: {
      location: 4,
      type: BYTE,
      size: BYTE_SIZE,
      length: 2,
      stride: 9,
      offset: 7,
      divisor: 1,
    },
  },
}
const DIMENSIONS = 2 // "2D"
const TILE_LENGTH = 3 // width / height (px)
const ATLAS_PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAECAMAAACwak/eAAAACVBMVEUAAAAA/wAAAABJBy5MAAAAA3RSTlMA//9EUNYhAAAAHElEQVQImWNgZGRkYGRgYmJigAJGJnQBdBXoAAAFvgAgrtOQUAAAAABJRU5ErkJggg=='
const TEX_COORD = { // px
  zero: { x: 0, y: 0 },
  one: { x: 3, y: 0 },
  // A full-screen black translucent texture used to gradually clear the
  // screen in several passes.
  clear: { x: 6, y: 0 },
}
const INSTANCE_TYPE = { zero: 'zero', one: 'one', clear: 'clear' }
const CLEAR_MINUS_ALPHA = 255 - 8 // 0-255
const SPAWN = {
  min: {
    minusAlpha: 0, // 0-255
    x: -TILE_LENGTH, // px
    y: -RESOLUTION, // px
    velocity: 4, // px / s
  },
  max: {
    minusAlpha: CLEAR_MINUS_ALPHA, // 0-255
    x: RESOLUTION + 2 * TILE_LENGTH, // px
    y: 0, // px
    velocity: 16, // px / s
  },
  total: 256, // instances of 0s and 1s (+ 1 instance for clearing).
}

function loadShader(gl, program, type, id) {
  const shader = gl.createShader(type)
  const src = document.querySelector(`#${id}`).textContent.trim()
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  const log = gl.getShaderInfoLog(shader)
  if (log) console.error(log)
  gl.attachShader(program, shader)
  return shader
}

function onPaused(state) {
  console.log('Paused.')
  cancelAnimationFrame(state.requestId)
}

function onResumed(state) {
  console.log('Resumed.')
  if (!state.gfx.gl.isContextLost()) {
    startLooping(state)
  }
}

function onContextLost(state, event) {
  console.log('GL context lost.')
  event.preventDefault()
  cancelAnimationFrame(state.requestId)
}

function onContextRestored(state) {
  console.log('GL context restored.')
  state.gfx = initGL(state, state.gfx.gl)
  if (!document.hidden) {
    startLooping(state)
  }
}

function startLooping(state) {
  state.requestId = requestAnimationFrame((now) => loop(state, now, now))
}

function rnd(min, max) {
  return min + Math.random() * (max - min)
}
function rndInt(min, max) {
  return Math.floor(rnd(min, max + 1))
}

function spawn() {
  return {
    type: rndInt(0, 1) ? INSTANCE_TYPE.zero : INSTANCE_TYPE.one,
    scale: { x: 1, y: 1 },
    minusAlpha: rnd(SPAWN.min.minusAlpha, SPAWN.max.minusAlpha),
    x: rnd(SPAWN.min.x, SPAWN.max.x), // px
    y: rnd(SPAWN.min.y, SPAWN.max.y), // px
    velocity: rnd(SPAWN.min.velocity, SPAWN.max.velocity), // px / s
  }
}

function updateInstanceData(data, instance, i) {
  const offset = i * ATTRIB_LAYOUT.instance.stride
  data[offset + 0] = TEX_COORD[instance.type].x
  data[offset + 1] = TEX_COORD[instance.type].y
  data[offset + 2] = TILE_LENGTH
  data[offset + 3] = TILE_LENGTH
  data[offset + 4] = instance.scale.x
  data[offset + 5] = instance.scale.y
  data[offset + 6] = instance.minusAlpha
  data[offset + 7] = instance.x
  data[offset + 8] = instance.y
  return data
}

function glBuffer(gl, buffer, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

function initVertexAttrib(gl, layout, buffer) {
  gl.enableVertexAttribArray(layout.location)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.vertexAttribPointer(
    layout.location,
    layout.length,
    layout.type,
    false,
    layout.stride,
    layout.offset,
  )
  gl.vertexAttribDivisor(layout.location, layout.divisor)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

function update(state, seconds) {
  state.instances.forEach((instance, i) => {
    instance.y += seconds * instance.velocity // y += s * px / s
    if (instance.y > RESOLUTION) state.instances[i] = spawn()
    updateInstanceData(state.attribData.instance, state.instances[i], i)
  })
}

function render(state) {
  const { gl, vertexArray, instanceBuffer } = state.gfx

  // Shader pixels are 1:1 with the canvas. No canvas CSS scaling.
  const w = window.innerWidth
  const h = window.innerHeight
  gl.canvas.width = w
  gl.canvas.height = h

  // The viewport fills or exceeds the canvas at integer multiples of
  // RESOLUTION.
  const multiple = Math.ceil(Math.max(w, h) / RESOLUTION)
  const side = multiple * RESOLUTION
  gl.viewport(0, 0, side, side)

  gl.bindVertexArray(vertexArray)

  glBuffer(gl, instanceBuffer, state.attribData.instance)

  const length = state.attribData.vert.length / DIMENSIONS
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, length, state.instances.length)

  gl.bindVertexArray(null)
}

function loop(state, then, now) {
  // A fraction / multiple of a second.
  const seconds = (now - then) / 1000

  then = now
  state.requestId = requestAnimationFrame((now) => loop(state, then, now))

  update(state, seconds)
  render(state)
}

function initGL(state, gl) {
  const proto = WebGLRenderingContext.prototype
  {
    const ext = gl.getExtension('ANGLE_instanced_arrays')
    if (!ext) {
      alert(
        'WebGL extension ANGLE_instanced_arrays is unsupported by this browser :-[',
      )
    }

    proto.drawArraysInstanced = ext.drawArraysInstancedANGLE.bind(ext)
    proto.vertexAttribDivisor = ext.vertexAttribDivisorANGLE.bind(ext)
  }
  {
    const ext = gl.getExtension('OES_vertex_array_object')
    if (!ext) {
      alert(
        'WebGL extension OES_vertex_array_object is unsupported by this browser :-[',
      )
    }
    proto.createVertexArray = ext.createVertexArrayOES.bind(ext)
    proto.bindVertexArray = ext.bindVertexArrayOES.bind(ext)
  }

  gl.enable(gl.BLEND)
  gl.blendEquation(gl.FUNC_ADD)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const program = gl.createProgram()
  const vertShader = loadShader(gl, program, gl.VERTEX_SHADER, 'vert')
  const fragShader = loadShader(gl, program, gl.FRAGMENT_SHADER, 'frag')
  gl.linkProgram(program)
  gl.useProgram(program)

  gl.detachShader(program, fragShader)
  gl.detachShader(program, vertShader)
  gl.deleteShader(fragShader)
  gl.deleteShader(vertShader)

  const sampler = gl.getUniformLocation(program, 'sampler')
  const atlasSize = gl.getUniformLocation(program, 'atlasSize')
  gl.uniform1i(sampler, 0)
  gl.uniform2f(
    atlasSize,
    state.atlas.naturalWidth,
    state.atlas.naturalHeight,
  )

  gl.activeTexture(gl.TEXTURE0)
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    state.atlas,
  )

  const vertBuffer = gl.createBuffer()
  glBuffer(gl, vertBuffer, state.attribData.vert)
  const instanceBuffer = gl.createBuffer()

  const vertexArray = gl.createVertexArray()
  gl.bindVertexArray(vertexArray)
  initVertexAttrib(gl, ATTRIB_LAYOUT.vert.uv, vertBuffer)
  initVertexAttrib(gl, ATTRIB_LAYOUT.instance.texCoord, instanceBuffer)
  initVertexAttrib(gl, ATTRIB_LAYOUT.instance.scale, instanceBuffer)
  initVertexAttrib(gl, ATTRIB_LAYOUT.instance.minusAlpha, instanceBuffer)
  initVertexAttrib(gl, ATTRIB_LAYOUT.instance.position, instanceBuffer)
  gl.bindVertexArray(null)

  return { gl, program, vertexArray, vertBuffer, instanceBuffer }
}

function onAtlasLoaded(state, gl) {
  state.gfx = initGL(state, gl)

  addEventListener(
    'visibilitychange',
    () => document.hidden ? onPaused(state) : onResumed(state),
  )
  gl.canvas.addEventListener(
    'webglcontextlost',
    (event) => onContextLost(state, event),
  )
  gl.canvas.addEventListener(
    'webglcontextrestored',
    () => onContextRestored(state),
  )

  const extension = gl.getExtension('WEBGL_lose_context')
  if (extension) {
    addEventListener('keyup', (event) => {
      if (event.key != 'p') return
      if (gl.isContextLost()) extension.restoreContext()
      else extension.loseContext()
    })
  }

  if (!document.hidden && !gl.isContextLost()) {
    startLooping(state)
  }
}

const canvas = window.document.querySelector('canvas')
const gl = canvas.getContext('webgl', {
  alpha: false,
  depth: false,
  antialias: false,

  // Don't clear the screen. A full-screen black translucent texture is
  // drawn each render.
  preserveDrawingBuffer: true,
})

if (!gl) alert('WebGL is unsupported by this browser :-[')

const state = { requestId: undefined }
state.instances = Array.from(Array(SPAWN.total)).map(spawn)

// Clear the background in the first render pass by adding the clear type
// to the front of the instances.
state.instances.unshift({
  x: -1,
  y: 0,
  scale: {
    x: Math.ceil(RESOLUTION / TILE_LENGTH),
    y: Math.ceil(RESOLUTION / TILE_LENGTH),
  },
  minusAlpha: CLEAR_MINUS_ALPHA,
  velocity: 0,
  type: INSTANCE_TYPE.clear,
})

state.attribData = {
  vert: new Int8Array([ // Only UVs are per vertex.
    1,
    1,
    0,
    1,
    1,
    0,
    0,
    0,
  ]),
  instance: state.instances.reduce(
    updateInstanceData,
    new Int8Array(state.instances.length * ATTRIB_LAYOUT.instance.stride),
  ),
}

state.atlas = new Image()
state.atlas.onerror = () => {
  throw Error('Failed to load atlas.')
}
state.atlas.onload = () => onAtlasLoaded(state, gl)
state.atlas.src = ATLAS_PNG_URI
