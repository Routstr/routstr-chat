/* The living backdrop. One canvas, one full-screen triangle, one fragment
   shader per room. Every look parameter is read from CSS tokens, so a room is
   a stylesheet block and needs nothing here unless it brings a new shader.

   Cost rules (measured on the prototypes, see late-weather):
   - the canvas renders at 0.30 of its CSS size and is upscaled,
   - draws are capped at 20fps, 24 while a room change is settling,
   - nothing full-screen (blur, blend) ever sits on top of it,
   - while an answer streams the room holds its breath: time is pinned and
     draws stop once the settle has decayed. */

const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

const HEAD = `precision highp float;
uniform vec2 u_res;uniform float u_t,u_speed,u_int,u_scale,u_grain,u_alpha,u_pull,u_axis;
uniform vec3 u_c0,u_c1,u_c2,u_c3;
float h21(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 float a=h21(i),b=h21(i+vec2(1.,0.)),c=h21(i+vec2(0.,1.)),d=h21(i+vec2(1.,1.));
 return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(11.3,7.7);a*=.5;}return s;}
`;

/* night: ink moving in deep water, lit from one corner. u_pull leans the key
   light toward the reading panel while an answer is on its way. */
const CURRENT = `${HEAD}
void main(){
 vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y*u_scale;
 float t=u_t*u_speed*.055;
 vec2 q=vec2(fbm(p*1.35+vec2(.0,t)),fbm(p*1.35+vec2(5.2,1.3)-t*.76));
 vec2 r=vec2(fbm(p*2.05+2.9*q+vec2(1.7,9.2)+t*.42),fbm(p*2.05+2.7*q+vec2(8.3,2.8)-t*.3));
 float f=fbm(p*1.05+2.3*r);
 float band=f*.78+.22*fbm(p*vec2(.55,2.1)+vec2(t*.35,-t*.18));
 vec3 col=mix(u_c0,u_c1,smoothstep(.22,.78,band));
 col=mix(col,u_c2,smoothstep(.46,.98,band)*.9*u_int);
 vec2 key=mix(vec2(-.17,.43),vec2(.12,.22),u_pull);
 float lite=smoothstep(1.52+.18*u_pull,.0,length((p-key)*vec2(.66,1.22)));
 col=mix(col,u_c3,lite*lite*(.32+.14*u_pull)*u_int*(.55+.45*f));
 float haze=smoothstep(.8,.0,length((p-vec2(.55,-.5))*vec2(.7,1.)));
 col=mix(col,u_c2,haze*.08*u_int);
 col*=1.-.22*smoothstep(.55,1.45,length(p*vec2(.7,1.)));
 col+=(h21(gl_FragCoord.xy)-.5)*u_grain;
 gl_FragColor=vec4(col,u_alpha);
}`;

/* paper: fibre and very slow daylight. Nearly still. u_pull turns the
   daylight toward the panel and lifts it a little. */
const FIBRE = `${HEAD}
void main(){
 vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y*u_scale;
 float t=u_t*u_speed*.05;
 float ang=t*.34+.7+u_pull*.55;
 vec2 dir=vec2(cos(ang),sin(ang));
 float day=smoothstep(-1.15,1.15,dot(p,dir));
 vec3 col=mix(u_c0,u_c2,day*(.70+.08*u_pull)+.16);
 float cloud=fbm(p*2.4+vec2(t*.22,-t*.09));
 col=mix(col,u_c3,smoothstep(.34,.74,cloud)*.50*u_int);
 col=mix(col,u_c1,smoothstep(.20,.80,fbm(p*4.6-vec2(t*.17,t*.05)))*.34*u_int);
 float fib=vn(gl_FragCoord.xy*vec2(.85,.20))*.5+vn(gl_FragCoord.xy*vec2(.20,.85))*.5;
 col+=(fib-.5)*.030;
 col*=1.-.075*smoothstep(.5,1.35,length(p*vec2(.78,1.)));
 col+=(h21(gl_FragCoord.xy)-.5)*u_grain;
 gl_FragColor=vec4(col,u_alpha);
}`;

/* meridian: a window onto the day strip. Five taps across the window, left
   to right on a desktop and top to bottom on a phone (u_axis). The cross
   axis is four warped strata: a seam of the day seen side on. */
const MERIDIAN = `${HEAD}
uniform vec3 u_fl[5];uniform vec3 u_sk[5];
float fg(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vn(p);p=p*2.07+vec2(11.3,7.7);a*=.5;}return s/.875;}
void main(){
 vec2 uv=gl_FragCoord.xy/u_res;
 vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y*u_scale;
 float t=u_t*u_speed*.05;
 float a=mix(uv.x,1.-uv.y,u_axis);
 float b=mix(uv.y,uv.x,u_axis);
 float s=a*4.;
 vec3 fl=u_fl[0],sk=u_sk[0];
 for(int i=0;i<4;i++){float e=smoothstep(float(i),float(i)+1.,s);
  fl=mix(fl,u_fl[i+1],e);sk=mix(sk,u_sk[i+1],e);}
 float wv=fg(p*.92+vec2(t*.07,-t*.045)+vec2(4.1,2.7));
 float y=b+(wv-.5)*.30+(a-.5)*.075;
 vec3 c1=mix(fl,sk,.32),c2=mix(fl,sk,.66);
 vec3 col=fl;
 col=mix(col,c1,smoothstep(.22,.31,y));
 col=mix(col,c2,smoothstep(.49,.57,y));
 col=mix(col,sk,smoothstep(.74,.85,y));
 col=mix(col,mix(fl,sk,smoothstep(-.06,1.06,y)),u_axis);
 float sw=vn(p*.82+vec2(t*.055,t*.032)+vec2(7.3,1.9));
 col*=1.+(sw-.5)*(.050+.03*u_pull)*u_int;
 col*=1.-.030*smoothstep(.55,1.45,length(p*vec2(.82,1.)));
 col+=(h21(gl_FragCoord.xy)-.5)*u_grain;
 gl_FragColor=vec4(col,u_alpha);
}`;

/* overprint: two plates of coverage, warm and cool, on bare stock. The
   seams (u_seam.xy, in units of the split axis) sit in the gutters. u_pull
   pulls the plates into register while an answer is on its way. */
const OVERPRINT = `${HEAD}
uniform vec4 u_seam;
float ink(vec2 p){return vn(p)*.62+vn(p*2.13+vec2(7.1,3.3))*.38;}
void main(){
 vec2 uv=gl_FragCoord.xy/u_res;
 vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y*u_scale;
 float t=u_t*u_speed*.05;
 float s=mix(uv.x,uv.y,u_axis);
 float reg=1.-u_pull;
 float d=reg*.0016;
 float g0=u_seam.x,g1=u_seam.y,h=u_seam.z,f=h*1.5;
 float sa=s+d,sb=s-d;
 float a=clamp((1.-smoothstep(g0+h,g0+h+f,sa))+smoothstep(g1-h-f,g1-h,sa),0.,1.);
 float b=smoothstep(g0-h-f,g0-h,sb);
 vec2 e=min(gl_FragCoord.xy,u_res-gl_FragCoord.xy);
 float tw=mix(14.,6.,u_axis)*u_seam.w;
 float trim=smoothstep(tw*.5,tw,min(e.x,e.y));
 a*=trim;b*=trim;
 vec3 col=mix(u_c0,u_c1,a*u_int);
 col=mix(col,mix(u_c2,u_c3,a*u_int),b*u_int);
 col=mix(col,u_c3,a*b*(1.-reg)*.22);
 float da=ink(p*vec2(1.15,.85)+vec2(t*.9,-t*.4)+vec2(2.3,6.7));
 float db=ink(p*vec2(.95,1.05)+vec2(-t*.7,t*.5)+vec2(8.1,1.9));
 col*=1.+((da-.5)*a+(db-.5)*b)*.055;
 col+=(vn(gl_FragCoord.xy*.55)-.5)*.020;
 col*=1.-.05*smoothstep(.62,1.42,length(p*vec2(.82,1.)));
 col+=(h21(gl_FragCoord.xy)-.5)*u_grain;
 gl_FragColor=vec4(col,u_alpha);
}`;

const SOURCES: Record<string, string> = {
  current: CURRENT,
  fibre: FIBRE,
  meridian: MERIDIAN,
  overprint: OVERPRINT,
};

type Vec3 = [number, number, number];

const hex = (s: string): Vec3 => {
  const m = /^#?([0-9a-f]{6})$/i.exec((s || "").trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const lum = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const css = (c: Vec3) =>
  `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")})`;

/* ══ the day strip ═══════════════════════════════════════════════════════
   Twenty-four hours, each a floor colour (the dense end of the field) and a
   sky colour (the thin end). A mineral seam cut through a day rather than a
   picture of weather: indigo, glacial violet, sulphur, stone, bleached green
   at noon, olive, ochre, oxidised mauve, back to indigo. */
const HOURS: [string, string, string][] = [
  ["small hours", "#201A3C", "#0C0E27"],
  ["small hours", "#271F45", "#10102B"],
  ["deep night", "#311D46", "#130E27"],
  ["deep night", "#472151", "#180F2B"],
  ["cold hour", "#2D2554", "#111636"],
  ["before light", "#4A4653", "#22273A"],
  ["first light", "#706A61", "#3B414C"],
  ["early", "#948558", "#525F74"],
  ["morning", "#A59760", "#677882"],
  ["morning", "#ACA56C", "#7E928A"],
  ["late morning", "#AFB86C", "#8CA98F"],
  ["near noon", "#B6BF77", "#94B497"],
  ["high noon", "#BDC19A", "#9DB6A0"],
  ["afternoon", "#B9C078", "#97B597"],
  ["afternoon", "#B5B562", "#91AB88"],
  ["low sun", "#B4A54F", "#909A7C"],
  ["late afternoon", "#AB8A37", "#7D8971"],
  ["before dusk", "#987248", "#696F63"],
  ["the turn", "#73524C", "#484E59"],
  ["dusk", "#5A3A4C", "#373F58"],
  ["evening", "#462E54", "#293158"],
  ["late evening", "#3C2352", "#1E254E"],
  ["night", "#2F1D4C", "#151C40"],
  ["night", "#241C3F", "#0E1233"],
];
const FLOOR = HOURS.map((h) => hex(h[1]));
const SKY = HOURS.map((h) => hex(h[2]));

export const DayStrip = {
  at(h: number) {
    h = ((h % 24) + 24) % 24;
    const i = Math.floor(h);
    const f = h - i;
    const j = (i + 1) % 24;
    const u = f * f * (3 - 2 * f);
    return { fl: mix3(FLOOR[i], FLOOR[j], u), sk: mix3(SKY[i], SKY[j], u) };
  },
  band(h: number) {
    return HOURS[Math.floor(((h % 24) + 24) % 24)][0];
  },
  /* Sample the window and remap its luminance into the band the current
     face allows. The remap is additive, so an hour only ever gets lighter or
     darker than authored, never more colourful. */
  view(h: number, half: number, n: number, b0: number, b1: number) {
    const cols: Vec3[] = [];
    for (let i = 0; i < n; i++) cols.push(DayStrip.at(h + ((i / (n - 1)) * 2 - 1) * half).fl);
    for (let i = 0; i < n; i++) cols.push(DayStrip.at(h + ((i / (n - 1)) * 2 - 1) * half).sk);
    let lo = 2;
    let hi = -1;
    for (const c of cols) {
      const b = lum(c);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
    }
    const span = Math.max(hi - lo, 1e-4);
    const map = (c: Vec3): Vec3 => {
      const b = lum(c);
      const d = b0 + (b1 - b0) * ((b - lo) / span) - b;
      return [
        Math.max(0, Math.min(1, c[0] + d)),
        Math.max(0, Math.min(1, c[1] + d)),
        Math.max(0, Math.min(1, c[2] + d)),
      ];
    };
    const fl = new Float32Array(n * 3);
    const sk = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      fl.set(map(cols[i]), i * 3);
      sk.set(map(cols[n + i]), i * 3);
    }
    const m = (n - 1) >> 1;
    return { fl, sk, flat: css(mix3(map(cols[m]), map(cols[n + m]), 0.42)) };
  },
  /* one hour as a small window onto the room: sky over floor */
  paint(h: number) {
    const c = DayStrip.at(h);
    return `linear-gradient(170deg, ${css(c.sk)}, ${css(c.fl)})`;
  },
  /* the whole day round a dot: midnight at the bottom, noon at the top */
  dial() {
    const s: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const c = DayStrip.at(i % 24);
      s.push(`${css(mix3(c.fl, c.sk, 0.3))} ${((i / 24) * 360).toFixed(1)}deg`);
    }
    return `conic-gradient(from 180deg,${s.join(",")})`;
  },
};

interface Look {
  id: string;
  c: [Vec3, Vec3, Vec3, Vec3];
  speed: number;
  int: number;
  scale: number;
  grain: number;
  b0: number;
  b1: number;
}

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

const UNIFORMS = [
  "u_res", "u_t", "u_speed", "u_int", "u_scale", "u_grain", "u_alpha", "u_pull", "u_axis",
  "u_c0", "u_c1", "u_c2", "u_c3", "u_fl[0]", "u_sk[0]", "u_seam",
];

const QUALITY = 0.3;
const IDLE_MS = 50; // 20fps
const SETTLE_MS = 42; // 24fps while a room change arrives

export class Backdrop {
  private gl: WebGLRenderingContext | null;
  private canvas: HTMLCanvasElement;
  private buf: WebGLBuffer | null = null;
  private progs: Record<string, Program> = {};
  private cur: Look | null = null;
  private prev: Look | null = null;
  private fade = 1;
  private t = 0;
  private last = 0;
  private raf = 0;
  private pull = 0;
  private pullTarget = 0;
  private settle = 0;
  private holding = false;
  private axis = 0;
  private hour = 12;
  private seam: [number, number, number, number] = [0.2, 1.2, 0.012, 1];
  readonly dead: boolean;
  still = false;
  reduced = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const opts = { antialias: false, alpha: false, depth: false, powerPreference: "low-power" as const };
    this.gl =
      (canvas.getContext("webgl2", opts) as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl", opts) as WebGLRenderingContext | null);
    this.dead = !this.gl;
    if (!this.gl) return;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.resize();
  }

  private prog(id: string): Program | null {
    if (this.progs[id]) return this.progs[id];
    const gl = this.gl!;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, VERT);
    const f = compile(gl.FRAGMENT_SHADER, SOURCES[id] ?? CURRENT);
    if (!v || !f) return null;
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, "a");
    gl.linkProgram(p);
    const u: Program["u"] = {};
    for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
    return (this.progs[id] = { p, u });
  }

  private readLook(): Look {
    const cs = getComputedStyle(document.documentElement);
    const g = (n: string) => cs.getPropertyValue(n).trim();
    return {
      id: g("--sh-id") || "current",
      c: [hex(g("--sh-c0")), hex(g("--sh-c1")), hex(g("--sh-c2")), hex(g("--sh-c3"))],
      speed: parseFloat(g("--sh-speed")) || 0.4,
      int: parseFloat(g("--sh-intensity")) || 0.8,
      scale: parseFloat(g("--sh-scale")) || 1,
      grain: parseFloat(g("--sh-grain")) || 0.03,
      b0: parseFloat(g("--room-b0")) || 0.55,
      b1: parseFloat(g("--room-b1")) || 0.74,
    };
  }

  /** Re-read the room from CSS. `animate` crossfades from the old light. */
  setRoom(animate: boolean) {
    if (this.dead) return;
    const next = this.readLook();
    if (this.cur && animate && !this.reduced) {
      this.prev = this.cur;
      this.fade = 0;
    } else {
      this.prev = null;
      this.fade = 1;
    }
    this.cur = next;
    this.draw();
  }

  setHour(h: number) {
    this.hour = h;
    this.draw();
  }

  setSeam(x0: number, x1: number, half: number, vertical: boolean) {
    this.seam = [x0, x1, half, 1];
    this.axis = vertical ? 1 : 0;
    this.draw();
  }

  /** How close the answer is, 0 (idle) to 1 (thinking). Smoothed. */
  setPull(target: number) {
    this.pullTarget = target;
    this.kick();
  }

  /** The first answer token landed: one breath out, then hold still. */
  exhale() {
    this.settle = 1;
    this.holding = true;
    this.kick();
  }

  release() {
    this.holding = false;
    this.kick();
  }

  resize() {
    if (this.dead) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr * QUALITY));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr * QUALITY));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl!.viewport(0, 0, w, h);
    }
    this.axis = this.canvas.clientWidth < 760 ? 1 : 0;
    this.draw();
  }

  private pass(look: Look, alpha: number, pull: number) {
    const gl = this.gl!;
    const o = this.prog(look.id);
    if (!o) return;
    gl.useProgram(o.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = o.u;
    gl.uniform2f(u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_t, this.still ? 12 : this.t);
    gl.uniform1f(u.u_speed, look.speed);
    gl.uniform1f(u.u_int, look.int);
    gl.uniform1f(u.u_scale, look.scale);
    gl.uniform1f(u.u_grain, look.grain);
    gl.uniform1f(u.u_alpha, alpha);
    gl.uniform1f(u.u_pull, pull);
    gl.uniform1f(u.u_axis, this.axis);
    gl.uniform3fv(u.u_c0, look.c[0]);
    gl.uniform3fv(u.u_c1, look.c[1]);
    gl.uniform3fv(u.u_c2, look.c[2]);
    gl.uniform3fv(u.u_c3, look.c[3]);
    if (look.id === "meridian" && u["u_fl[0]"]) {
      const v = DayStrip.view(this.hour, 2, 5, look.b0, look.b1);
      gl.uniform3fv(u["u_fl[0]"], v.fl);
      gl.uniform3fv(u["u_sk[0]"], v.sk);
    }
    if (look.id === "overprint" && u.u_seam) gl.uniform4fv(u.u_seam, this.seam);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private draw() {
    if (this.dead || !this.cur) return;
    // one breath let out: the light passes a little past rest, then settles
    const pull = Math.max(0, this.pull - 0.28 * this.settle);
    if (this.prev && this.fade < 1) {
      if (this.prev.id === this.cur.id) {
        const t = this.fade;
        const a = this.prev;
        const b = this.cur;
        this.pass(
          {
            ...b,
            c: [mix3(a.c[0], b.c[0], t), mix3(a.c[1], b.c[1], t), mix3(a.c[2], b.c[2], t), mix3(a.c[3], b.c[3], t)],
            speed: a.speed + (b.speed - a.speed) * t,
            int: a.int + (b.int - a.int) * t,
            scale: a.scale + (b.scale - a.scale) * t,
            grain: a.grain + (b.grain - a.grain) * t,
            b0: a.b0 + (b.b0 - a.b0) * t,
            b1: a.b1 + (b.b1 - a.b1) * t,
          },
          1,
          pull
        );
      } else {
        this.pass(this.prev, 1, pull);
        this.pass(this.cur, this.fade * this.fade * (3 - 2 * this.fade), pull);
      }
    } else {
      this.pass(this.cur, 1, pull);
    }
  }

  private busy() {
    return (
      this.fade < 1 ||
      Math.abs(this.pull - this.pullTarget) > 0.002 ||
      this.settle > 0.002
    );
  }

  private kick() {
    if (!this.raf && !this.dead) this.loop();
  }

  start() {
    if (this.dead) return;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.draw();
    if (this.still || this.reduced) return;
    this.loop();
  }

  private loop() {
    const step = (now: number) => {
      this.raf = 0;
      if (document.hidden) {
        this.last = now;
        this.raf = requestAnimationFrame(step);
        return;
      }
      if (!this.last) this.last = now;
      const busy = this.busy();
      const budget = this.fade < 1 ? SETTLE_MS : IDLE_MS;
      if (now - this.last >= budget) {
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        // 300ms time constant toward the phase target
        this.pull += (this.pullTarget - this.pull) * (1 - Math.exp(-dt / 0.3));
        this.settle *= Math.exp(-dt / 0.42);
        if (this.settle < 0.002) this.settle = 0;
        if (!this.holding && !this.still && !this.reduced) this.t += dt;
        if (this.fade < 1) {
          this.fade = Math.min(1, this.fade + dt / 1.05);
          if (this.fade >= 1) this.prev = null;
        }
        this.draw();
      }
      // holding with nothing left to settle: stop issuing frames entirely
      if ((this.holding || this.still || this.reduced) && !busy) return;
      this.raf = requestAnimationFrame(step);
    };
    this.last = 0;
    this.raf = requestAnimationFrame(step);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
