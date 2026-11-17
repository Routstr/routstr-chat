/* The landing page's light (routstr landingpage, components/try/light/fibres.ts), cut down to
   what a gift needs, in two sets of fibres drawn one after the other with their own poses:
   - the wrapping: cool fibres wound into a ball (or twisted into one cable), gold pulses running
     along them, and a burst of gold that runs along the threads from where it is opened;
   - the ₿ inside: gold fibres laid as lanes facing you and cut to the bitcoin sign (the one on
     the Bitcoin logo, public domain), the landing's way of drawing its mark. Gathered back, the
     lanes are the cable again.

   It touches nothing of the page, so it runs on a thread of its own (light.worker.ts), where the
   app's own work never stalls it.

   Pipeline: fibres -> half-float scene -> two blurred copies -> one composite pass that adds
   the glow, a little lens fringe, and tone-maps. */

export type Pose = {
  /** 0 a cable, 1 a ball, 2 lanes facing you, 3 those lanes pouring into the balance */
  form: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  gain: number;
  pulse: number;
  /** How much near and far fibres go out of focus. */
  blur: number;
  /** 1 where the fibres are cut to the ₿. */
  mark: number;
};
/** One moment: the wrapping and the ₿, each in its own pose. */
export type Scene = { wrap: Pose; coin: Pose };

const SEGMENTS = 132;

const FIBRE_VERT = `#version 300 es
precision highp float;
layout(location=0) in float a_s;
layout(location=1) in float a_side;
layout(location=2) in vec4 a_seed;
layout(location=3) in float a_lane;
uniform float u_time, u_from, u_to, u_mix, u_width, u_rush, u_blur;
uniform mat4 u_mvp;
uniform vec2 u_res;
uniform vec2 u_touch;
uniform vec3 u_burst;
uniform vec2 u_home;
out float v_side;
out float v_s;
out vec4 v_seed;
out float v_depth;
out float v_ends;
out float v_soft;
out float v_hit;
out float v_near;
out float v_closed;
out vec2 v_mark;
out float v_pour;
const float TAU = 6.2831853;

vec3 form(float k, float s, vec4 sd, float lane, float t) {
  if (k < 0.5) {
    // cable: every fibre twisted into one line
    float x = (s - 0.5) * 9.0;
    float r = 0.02 + 0.2 * sd.x * sd.x;
    float a = sd.y * TAU + s * (5.0 + 5.0 * sd.z) + t * 0.4;
    float sag = 0.26 * sin(x * 0.62 + t * 0.2);
    return vec3(x, sag + r * cos(a), r * sin(a));
  }
  if (k < 1.5) {
    // ball: each fibre a great circle
    float th = s * TAU + t * 0.06 * (sd.w - 0.5);
    float a1 = sd.y * TAU;
    float a2 = acos(2.0 * sd.z - 1.0);
    vec3 n = vec3(sin(a2) * cos(a1), cos(a2), sin(a2) * sin(a1));
    vec3 u = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 v = cross(n, u);
    return (1.08 + 0.03 * sd.x) * (cos(th) * u + sin(th) * v);
  }
  // lanes: side by side, facing you, a little alive; the ₿ is cut from them in the fragment shader
  float x = (s - 0.5) * 3.0;
  float y = (lane - 0.5) * 2.5;
  return vec3(x, y + 0.01 * sin(x * 5.0 + t * 0.9 + lane * 40.0), 0.05 * sin(x * 2.2 + t * 0.6 + y * 3.0));
}

/* 1 for a shape that comes back round to where it began (the ball), 0 for one that runs off its ends. */
float closed(float k) {
  return clamp(1.0 - abs(k - 1.0), 0.0, 1.0);
}

/* Poured: each point of a lane leaves the ₿ in turn, the lane's head first, and arcs into the
   balance (u_home, in the ₿'s own units); q is how far along it is. */
float pouring(float s, float m) {
  float q = clamp(m * 1.3 - (1.0 - s) * 0.3, 0.0, 1.0);
  return q * q * (3.0 - 2.0 * q);
}
vec3 pour(float s, float m) {
  vec3 p = form(2.0, s, a_seed, a_lane, u_time);
  float q = pouring(s, m);
  vec2 d = u_home - p.xy;
  vec2 bow = (p.xy + u_home) * 0.5 + vec2(-d.y, d.x) * 0.22;
  return vec3(mix(mix(p.xy, bow, q), mix(bow, u_home, q), q), p.z * (1.0 - q));
}

vec3 at(float s, float m) {
  // (once poured it stays poured)
  if (u_to > 2.5) return pour(s, u_from > 2.5 ? 1.0 : m);
  vec3 p;
  if (m <= 0.0) p = form(u_from, s, a_seed, a_lane, u_time);
  else if (m >= 1.0) p = form(u_to, s, a_seed, a_lane, u_time);
  else p = mix(form(u_from, s, a_seed, a_lane, u_time), form(u_to, s, a_seed, a_lane, u_time), m);
  // held, the whole thing winds up along its length (round a ball, so its loops stay closed)
  float loops = mix(closed(u_from), closed(u_to), m);
  float w = u_rush * 0.9 * mix(s - 0.5, 0.5 * sin(s * TAU), loops);
  float c = cos(w);
  float n = sin(w);
  return vec3(p.x, p.y * c - p.z * n, p.y * n + p.z * c);
}

/* How far this point of the fibre is from where the gift was opened, on screen (squared). */
float miss(float s, float m, vec2 spot) {
  vec4 p = u_mvp * vec4(at(s, m), 1.0);
  vec2 d = p.xy / p.w - spot;
  d.x *= u_res.x / u_res.y;
  return dot(d, d);
}

void main() {
  // fibres set off one after another, so a change of shape reads as a flow
  float m = clamp(u_mix * 1.4 - a_seed.w * 0.4, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  vec4 here = u_mvp * vec4(at(a_s, m), 1.0);
  vec4 next = u_mvp * vec4(at(a_s + 1.0 / ${SEGMENTS}.0, m), 1.0);
  vec2 dir = (next.xy / next.w - here.xy / here.w) * u_res;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);

  // the fibres part softly around the pointer
  vec2 away = here.xy / here.w - u_touch;
  away.x *= u_res.x / u_res.y;
  here.xy += away * vec2(u_res.y / u_res.x, 1.0) * exp(-dot(away, away) * 6.5) * 0.13 * here.w;

  // out of the plane of focus a fibre gets wider and fainter
  float off = clamp(abs(here.w - 6.0) / 2.4, 0.0, 1.0);
  float spread = 1.0 + off * off * u_blur * 3.2;
  float width = u_width * (0.55 + 0.95 * a_seed.x) * clamp(5.6 / here.w, 0.5, 2.4) * spread;
  here.xy += vec2(-dir.y, dir.x) * a_side * width / u_res * 2.0 * here.w;
  gl_Position = here;

  v_side = a_side;
  v_s = a_s;
  v_seed = a_seed;
  v_depth = here.w;
  v_soft = 1.0 / spread;
  v_closed = mix(closed(u_from), closed(u_to), m);
  v_pour = u_to > 2.5 ? pouring(a_s, u_from > 2.5 ? 1.0 : m) : 0.0;
  // where this point of the fibre sits in the ₿'s square
  vec3 plane = form(2.0, a_s, a_seed, a_lane, 0.0);
  v_mark = plane.xy / 2.3 + 0.5;
  v_ends = mix(smoothstep(0.0, 0.14, a_s) * smoothstep(1.0, 0.86, a_s), 1.0, v_closed);

  // opened: find where along itself this fibre passes nearest to that spot (a coarse walk, then a finer one)
  v_hit = 0.0;
  v_near = 0.0;
  if (u_burst.z < 1.7) {
    float best = 0.0;
    float least = 1e9;
    for (int i = 0; i < 10; i++) {
      float s = (float(i) + 0.5) / 10.0;
      float d = miss(s, m, u_burst.xy);
      if (d < least) {
        least = d;
        best = s;
      }
    }
    float around = best;
    for (int i = -2; i <= 2; i++) {
      float s = clamp(around + float(i) / 40.0, 0.0, 1.0);
      float d = miss(s, m, u_burst.xy);
      if (d < least) {
        least = d;
        best = s;
      }
    }
    v_hit = best;
    v_near = exp(-least / 0.008);
  }
}`;

const FIBRE_FRAG = `#version 300 es
precision highp float;
in float v_side;
in float v_s;
in vec4 v_seed;
in float v_depth;
in float v_ends;
in float v_soft;
in float v_hit;
in float v_near;
in float v_closed;
in vec2 v_mark;
in float v_pour;
uniform float u_flow, u_gain, u_pulse, u_gold, u_mark;
uniform sampler2D u_coin;
uniform vec3 u_burst;
out vec4 o;
void main() {
  float edge = 1.0 - smoothstep(0.3 * v_soft, 1.0, abs(v_side));
  // one fibre in three carries a pulse of gold
  float carries = step(0.66, v_seed.y);
  float phase = fract(v_s * (1.0 + floor(v_seed.x * 2.0)) - u_flow * (0.03 + 0.05 * v_seed.z) + v_seed.w);
  float pulse = smoothstep(0.0, 0.012, phase) * smoothstep(0.075, 0.012, phase) * carries;
  vec3 cool = mix(vec3(0.56, 0.68, 1.0), vec3(0.88, 0.93, 1.0), v_seed.z);
  vec3 gold = vec3(1.0, 0.68, 0.26);
  vec3 col = mix(cool * (0.035 + 0.3 * v_seed.x * v_seed.x), gold * (0.12 + 0.4 * v_seed.x * v_seed.x), u_gold);
  col += gold * pulse * u_pulse * 1.9;

  // opened: the fibres under that spot light up there, and the gold runs away along each of them, both ways
  float age = u_burst.z;
  float since = age - v_seed.w * 0.12;
  float apart = abs(v_s - v_hit);
  apart = mix(apart, min(apart, 1.0 - apart), v_closed);
  float gone = 0.46 * (1.0 - exp(-2.3 * max(since, 0.0))) * (0.7 + 0.6 * v_seed.z);
  float head = (1.0 - smoothstep(gone, gone + 0.012, apart)) * exp(-(gone - apart) * 12.0);
  float burst = head * v_near * step(0.0, since) * exp(-since * 1.1) * (1.0 - smoothstep(0.9, 1.6, age));
  col += gold * min(burst, 1.7) * 2.5;

  float fog = mix(1.0, 0.22, smoothstep(4.4, 8.2, v_depth));
  // the ₿: bright inside its shape, gone outside it
  vec2 q = v_mark;
  float inside = texture(u_coin, q).r * step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  // poured: brighter in flight, gone as it reaches the balance
  float flight = (1.0 + 1.6 * sin(v_pour * 3.14159)) * (1.0 - smoothstep(0.8, 1.0, v_pour));
  o = vec4(col * edge * fog * v_ends * v_soft * mix(1.0, inside, u_mark) * flight * u_gain, 1.0);
}`;

const QUAD_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_step;
out vec4 o;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb * 0.227027;
  c += (texture(u_tex, v_uv + u_step * 1.3846).rgb + texture(u_tex, v_uv - u_step * 1.3846).rgb) * 0.316216;
  c += (texture(u_tex, v_uv + u_step * 3.2308).rgb + texture(u_tex, v_uv - u_step * 3.2308).rgb) * 0.070270;
  o = vec4(c, 1.0);
}`;

/* The light itself, as much covering as it is bright, so the panel shows round it. */
const FINAL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene, u_glow, u_haze;
out vec4 o;
void main() {
  // a lens: colours part a hair toward the edges of the frame
  vec2 out2 = (v_uv - 0.5) * dot(v_uv - 0.5, v_uv - 0.5) * 0.014;
  vec3 sharp = vec3(texture(u_scene, v_uv + out2).r, texture(u_scene, v_uv).g, texture(u_scene, v_uv - out2).b);
  vec3 c = sharp + texture(u_glow, v_uv).rgb * 0.55 + texture(u_haze, v_uv).rgb * 0.5;
  c = 1.0 - exp(-c * 1.35);
  o = vec4(c, max(c.r, max(c.g, c.b)));
}`;

type Target = {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
};
type Program = {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
};

/* ── small matrix kit, column-major ─────────────────────────────────────── */
type Mat = Float32Array;
const identity = (): Mat =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a: Mat, b: Mat): Mat {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      m[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return m;
}
function perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number
): Mat {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
function translate(x: number, y: number, z: number): Mat {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function rotate(axis: 0 | 1 | 2, angle: number): Mat {
  const m = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  m[a * 4 + a] = c;
  m[b * 4 + b] = c;
  m[a * 4 + b] = s;
  m[b * 4 + a] = -s;
  return m;
}
function scale(k: number): Mat {
  const m = identity();
  m[0] = m[5] = m[10] = k;
  return m;
}
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const ease = (t: number) => t * t * (3 - 2 * t);

const CAMERA = 6;
const FOV = 0.6;
/** How long the opening takes: one cable crosses, then winds into the first shape. */
const OPENING = 2.6;
const BASE_COUNT = 560;

/** Half the height the light sees, in its own units, at the plane of focus. */
export const HALF = Math.tan(FOV / 2) * CAMERA;

/** The bitcoin sign from the Bitcoin logo (public domain; its 64 unit square). */
const SIGN =
  "m46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.99,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z";
/** Its middle and height, in the logo's units (measured from the path). */
const SIGN_MIDDLE = [30.876, 31.4145];
const SIGN_HEIGHT = 40.523;

/** The sign as a soft-edged mask, white on black, 2 of the lanes' units tall in their 2.3 square. */
function coinMask(): OffscreenCanvas {
  const size = 512;
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);
  g.filter = "blur(1px)";
  const k = ((2 / SIGN_HEIGHT) * size) / 2.3;
  g.setTransform(
    k,
    0,
    0,
    k,
    size / 2 - SIGN_MIDDLE[0] * k,
    size / 2 - SIGN_MIDDLE[1] * k
  );
  g.fillStyle = "#fff";
  g.fill(new Path2D(SIGN));
  return canvas;
}

export class Fibres {
  private gl: WebGL2RenderingContext | null;
  private programs: Record<string, Program> = {};
  private fibreVao: WebGLVertexArrayObject | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private coin: WebGLTexture | null = null;
  private targets: Target[] = [];
  private float = false;
  private frame = 0;
  private time = 0;
  private flow = 0;
  private stage = 0;
  private rush = 0;
  private pointer = [0, 0];
  private lean = [0, 0];
  /** The pointer on screen, -1..1, eased; far away until it first moves. */
  private touch = [-9, -9];
  private touchTarget = [-9, -9];
  /** Where it was opened, on screen, and how long ago (9: not yet). */
  private opened = new Float32Array([0, 0, 9]);
  private quality = 1;
  private slow = 0;
  private age = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Drawn on the CPU: keep a still picture, never an animation. */
  private frugal = false;
  /** Nothing moves by itself (reduced motion, or drawn on the CPU). */
  private still = false;
  /** Where it is: 0 for the first scene, 1 for the second, and between. */
  target = 0;
  /** Called at each frame before it is drawn, with the time since the last one (ms). */
  onFrame: ((dt: number) => void) | null = null;
  /** Where the ₿ pours to (form 3), in its own units from its middle. */
  home: [number, number] = [0, 0];
  readonly dead: boolean;

  /** The opening has played, or there is none: from here it answers a hand. */
  get arrived() {
    return this.dead || this.still || this.time >= OPENING;
  }

  constructor(
    private canvas: OffscreenCanvas,
    private scenes: (
      width: number,
      height: number
    ) => { opening: Scene; list: Scene[] },
    private counts: { wrap: number; coin: number },
    /** reduced motion: nothing moves by itself */
    reduced: boolean
  ) {
    this.still = reduced;
    this.gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
    });
    this.dead = !this.gl;
    if (!this.gl) return;
    const gl = this.gl;
    this.float =
      !!gl.getExtension("EXT_color_buffer_float") ||
      !!gl.getExtension("EXT_color_buffer_half_float");
    // without a graphics chip every frame would cost the page its own work
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.frugal = /swiftshader|llvmpipe|software|basic render/i.test(
      String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    );
    if (this.frugal) {
      this.quality = 0.5;
      this.still = true;
    }
    this.programs.fibre = this.program(FIBRE_VERT, FIBRE_FRAG, [
      "u_time",
      "u_flow",
      "u_from",
      "u_to",
      "u_mix",
      "u_width",
      "u_rush",
      "u_blur",
      "u_mvp",
      "u_res",
      "u_touch",
      "u_gain",
      "u_pulse",
      "u_gold",
      "u_burst",
      "u_mark",
      "u_coin",
      "u_home",
    ]);
    this.programs.blur = this.program(QUAD_VERT, BLUR_FRAG, [
      "u_tex",
      "u_step",
    ]);
    this.programs.final = this.program(QUAD_VERT, FINAL_FRAG, [
      "u_scene",
      "u_glow",
      "u_haze",
    ]);
    this.build();
    this.coin = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.coin);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      coinMask()
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private program(vert: string, frag: string, names: string[]): Program {
    const gl = this.gl!;
    const p = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vert],
      [gl.FRAGMENT_SHADER, frag],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.warn(gl.getShaderInfoLog(shader));
      gl.attachShader(p, shader);
    }
    gl.linkProgram(p);
    const u: Program["u"] = {};
    for (const name of names) u[name] = gl.getUniformLocation(p, name);
    return { p, u };
  }

  /** One ribbon per fibre: two vertices at each step along it. The wrapping first, then the ₿. */
  private build() {
    const gl = this.gl!;
    const { wrap, coin } = this.counts;
    const count = wrap + coin;
    const rows = SEGMENTS + 1;
    const data = new Float32Array(count * rows * 2 * 7);
    const index = new Uint32Array(count * SEGMENTS * 6);
    let d = 0;
    let n = 0;
    for (let f = 0; f < count; f++) {
      const seed = [Math.random(), Math.random(), Math.random(), Math.random()];
      // a lane's place, bottom to top (the wrapping has none)
      const lane = f < wrap ? -1 : (f - wrap) / Math.max(1, coin - 1);
      for (let r = 0; r < rows; r++) {
        for (const side of [-1, 1]) {
          data.set([r / SEGMENTS, side, ...seed, lane], d);
          d += 7;
        }
        if (r < SEGMENTS) {
          const a = (f * rows + r) * 2;
          index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], n);
          n += 6;
        }
      }
    }
    this.fibreVao = gl.createVertexArray();
    gl.bindVertexArray(this.fibreVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 28;
    [
      [0, 1, 0],
      [1, 1, 4],
      [2, 4, 8],
      [3, 1, 24],
    ].forEach(([at, size, offset]) => {
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        w,
        h,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    return { fbo, tex, w, h };
  }

  /** Its size on the page (css px) and the screen's pixel ratio. */
  resize(width = this.w, height = this.h, dpr = this.dpr) {
    if (!this.gl) return;
    const gl = this.gl;
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.dpr = dpr;
    const ratio = Math.min(dpr || 1, 2) * this.quality;
    const w = Math.max(2, Math.round(this.w * ratio));
    const h = Math.max(2, Math.round(this.h * ratio));
    this.canvas.width = w;
    this.canvas.height = h;
    for (const target of this.targets) {
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.tex);
    }
    const half = [Math.ceil(w / 2), Math.ceil(h / 2)];
    const sixth = [Math.ceil(w / 6), Math.ceil(h / 6)];
    // scene, then a tight glow (two passes) and a wide haze (two passes)
    this.targets = [
      this.makeTarget(w, h),
      this.makeTarget(half[0], half[1]),
      this.makeTarget(half[0], half[1]),
      this.makeTarget(sixth[0], sixth[1]),
      this.makeTarget(sixth[0], sixth[1]),
    ];
    this.draw(0);
  }

  /** The pointer, as a share of the canvas from its middle (-0.5..0.5). */
  point(x: number, y: number) {
    this.pointer = [x, y];
    this.touchTarget = [x * 2, -y * 2];
    if (this.touch[0] < -8) this.touch = [x * 2, -y * 2];
  }

  /** Opened here (a share of the canvas from its middle): gold runs away along the wrapping under it. */
  burst(x: number, y: number) {
    this.opened.set([x * 2, -y * 2, 0]);
  }

  start() {
    cancelAnimationFrame(this.frame);
    if (this.dead) return;
    let last = performance.now();
    let before = last;
    let fresh = true;
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      this.onFrame?.(now - before);
      before = now;
      if (this.frugal) {
        // only when it has moved, and not more than a few times a second
        if (
          !fresh &&
          (Math.abs(this.target - this.stage) < 0.002 || now - last < 140)
        )
          return;
      }
      const dt = Math.min(this.frugal ? 0.3 : 0.05, (now - last) / 1000);
      last = now;
      fresh = false;
      this.draw(dt);
    };
    this.frame = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.frame);
  }

  private blur(from: Target, to: Target, dx: number, dy: number) {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    gl.viewport(0, 0, to.w, to.h);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform2f(this.programs.blur.u.u_step, dx / to.w, dy / to.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private draw(dt: number) {
    const gl = this.gl;
    if (!gl || !this.targets.length) return;

    // a machine that cannot keep up gets fewer pixels, not a slower page
    // (a page is busy while it loads, whatever the machine: the first seconds do not count)
    this.age += dt;
    this.slow =
      dt > 0.03 && this.age > 4 ? this.slow + 1 : Math.max(0, this.slow - 1);
    if (!this.frugal && this.slow > 24 && this.quality > 0.5) {
      this.slow = 0;
      this.quality *= 0.78;
      this.resize();
      return;
    }

    // the shape follows with a little weight, never a snap
    const before = this.stage;
    this.stage += (this.target - this.stage) * (dt ? 1 - Math.exp(-dt * 5) : 1);
    const speed = dt ? clamp(((this.stage - before) / dt) * 0.55, -1, 1) : 0;
    this.rush += (speed - this.rush) * 0.08;
    if (!this.still) {
      this.time += dt;
      // the pulses run faster while it moves
      this.flow += dt * (1 + Math.abs(this.rush) * 7);
    }
    this.opened[2] = Math.min(9, this.opened[2] + dt);
    this.lean[0] += (this.pointer[0] - this.lean[0]) * 0.05;
    this.lean[1] += (this.pointer[1] - this.lean[1]) * 0.05;
    this.touch[0] += (this.touchTarget[0] - this.touch[0]) * 0.12;
    this.touch[1] += (this.touchTarget[1] - this.touch[1]) * 0.12;

    const { opening, list } = this.scenes(this.w, this.h);
    let a: Scene;
    let b: Scene;
    let mix: number;
    let flash = 1;
    const intro = this.still ? 1 : Math.min(1, this.time / OPENING);
    if (intro < 1 && this.stage < 0.25) {
      // the opening: one cable crosses, then winds into the first shape
      a = opening;
      b = list[0];
      mix = ease(clamp((intro - 0.22) / 0.78, 0, 1));
      flash =
        Math.min(1, intro * 6) *
        (1 + 0.9 * Math.exp(-Math.pow((intro - 0.4) / 0.16, 2)));
    } else {
      const from = Math.min(list.length - 1, Math.floor(this.stage));
      a = list[from];
      b = list[Math.min(list.length - 1, from + 1)];
      // hold each shape, change in between
      mix = ease(clamp((this.stage - from - 0.22) / 0.56, 0, 1));
    }

    const [scene, glowA, glowB, hazeA, hazeB] = this.targets;
    const aspect = this.w / this.h;
    const view = multiply(
      perspective(FOV, aspect, 0.1, 60),
      translate(0, 0, -CAMERA)
    );

    // 1. the fibres, added light on light: the wrapping, then the ₿
    const fibre = this.programs.fibre;
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(fibre.p);
    gl.uniform1f(fibre.u.u_time, this.time);
    gl.uniform1f(fibre.u.u_flow, this.flow);
    gl.uniform1f(fibre.u.u_mix, mix);
    gl.uniform1f(fibre.u.u_width, 1.15 * (scene.w / this.w));
    gl.uniform1f(fibre.u.u_rush, this.rush);
    gl.uniform2f(fibre.u.u_res, scene.w, scene.h);
    gl.uniform2f(fibre.u.u_touch, this.touch[0], this.touch[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.coin);
    gl.uniform1i(fibre.u.u_coin, 0);
    gl.bindVertexArray(this.fibreVao);
    const sets = [
      {
        from: a.wrap,
        to: b.wrap,
        count: this.counts.wrap,
        first: 0,
        gold: 0,
        burst: this.opened,
      },
      {
        from: a.coin,
        to: b.coin,
        count: this.counts.coin,
        first: this.counts.wrap,
        gold: 1,
        burst: [0, 0, 9],
      },
    ];
    for (const { from, to, count, first, gold, burst } of sets) {
      const lerp = (key: keyof Pose) => from[key] + (to[key] - from[key]) * mix;
      const gain =
        lerp("gain") *
        flash *
        (BASE_COUNT / count) *
        (1 + Math.abs(this.rush) * 0.5);
      if (gain <= 0.0005) continue;
      const model = [
        translate(lerp("x"), lerp("y"), 0),
        rotate(
          1,
          lerp("yaw") + Math.sin(this.time * 0.11) * 0.1 + this.lean[0] * 0.22
        ),
        rotate(0, lerp("pitch") + this.lean[1] * 0.14),
        rotate(2, lerp("roll")),
        scale(lerp("scale")),
      ].reduce(multiply);
      gl.uniform1f(fibre.u.u_from, from.form);
      gl.uniform1f(fibre.u.u_to, to.form);
      gl.uniform1f(fibre.u.u_blur, lerp("blur"));
      gl.uniform1f(fibre.u.u_gold, gold);
      gl.uniform1f(fibre.u.u_mark, lerp("mark"));
      gl.uniform2f(fibre.u.u_home, this.home[0], this.home[1]);
      // the same light whether there are few fibres or many
      gl.uniform1f(fibre.u.u_gain, gain);
      gl.uniform1f(
        fibre.u.u_pulse,
        lerp("pulse") * (1 + Math.abs(this.rush) * 1.5)
      );
      gl.uniformMatrix4fv(fibre.u.u_mvp, false, multiply(view, model));
      gl.uniform3fv(fibre.u.u_burst, burst);
      gl.drawElements(
        gl.TRIANGLES,
        count * SEGMENTS * 6,
        gl.UNSIGNED_INT,
        first * SEGMENTS * 6 * 4
      );
    }
    gl.disable(gl.BLEND);

    // 2. glow and haze
    gl.bindVertexArray(this.quadVao);
    gl.useProgram(this.programs.blur.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.programs.blur.u.u_tex, 0);
    this.blur(scene, glowA, 1, 0);
    this.blur(glowA, glowB, 0, 1);
    this.blur(glowB, hazeA, 1.6, 0);
    this.blur(hazeA, hazeB, 0, 1.6);
    this.blur(hazeB, hazeA, 1.6, 0);
    this.blur(hazeA, hazeB, 0, 1.6);

    // 3. everything together
    const final = this.programs.final;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(final.p);
    [scene, glowB, hazeB].forEach((target, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
    });
    gl.uniform1i(final.u.u_scene, 0);
    gl.uniform1i(final.u.u_glow, 1);
    gl.uniform1i(final.u.u_haze, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
