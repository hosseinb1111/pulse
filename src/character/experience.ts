const THREE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let THREE: any = null;
let threeModulePromise: Promise<any> | null = null;

/** Loads the pinned renderer only when the portrait is mounted. */
export async function createCharacterExperience(
  canvas: HTMLCanvasElement,
  stateElement: HTMLElement,
): Promise<CharacterExperience> {
  threeModulePromise ??= import(/* @vite-ignore */ THREE_MODULE_URL);
  THREE = await threeModulePromise;
  return new CharacterExperience(canvas, stateElement);
}
import type { AudioFrame } from '../analysis';
import { currentPalette } from '../themes';
import { settings } from '../settings';
import { MusicBehaviorController, clamp, stateLabel, styleLabel } from './music-behavior';
import type { CharacterEmotion, CharacterDrive, CharacterState, MusicStyle } from './music-behavior';

interface Pivot {
  group: any;
  side: number;
}

interface FingerPivot extends Pivot {
  index: number;
}

interface EyeRig {
  group: any;
  irisMeshes: any[];
}

interface ExpressionShape {
  eyeOpen: number;
  browLift: number;
  smile: number;
  mouthCurve: number;
  mouthWidth: number;
  tilt: number;
}

const EXPRESSION_KEYS: readonly (keyof ExpressionShape)[] = [
  'eyeOpen', 'browLift', 'smile', 'mouthCurve', 'mouthWidth', 'tilt',
];

const STYLE_MOTION_SCALE: Record<MusicStyle, number> = {
  ambient: 0.28,
  lofi: 0.48,
  groove: 0.92,
  upbeat: 0.82,
  intense: 1,
  cinematic: 0.4,
  electronic: 0.9,
};

const EXPRESSIONS: Record<CharacterEmotion, ExpressionShape> = {
  neutral:       { eyeOpen: 1,    browLift: 0,     smile: 0,    mouthCurve: 1,    mouthWidth: 1,    tilt: 0 },
  relaxed:       { eyeOpen: .88, browLift: .012,  smile: .08,  mouthCurve: .72,  mouthWidth: 1.02, tilt: -.015 },
  happy:         { eyeOpen: 1.02, browLift: .025, smile: .62,  mouthCurve: .34,  mouthWidth: 1.1,  tilt: -.01 },
  'subtle-smile':{ eyeOpen: .98, browLift: .012,  smile: .30,  mouthCurve: .6,   mouthWidth: 1.06, tilt: 0 },
  excited:       { eyeOpen: 1.12, browLift: .06,   smile: .78,  mouthCurve: .22,  mouthWidth: 1.13, tilt: .01 },
  curious:       { eyeOpen: 1.06, browLift: .05,   smile: .08,  mouthCurve: .9,   mouthWidth: 1,    tilt: .035 },
  thoughtful:    { eyeOpen: .86, browLift: -.025, smile: -.05, mouthCurve: -.48, mouthWidth: 1.02, tilt: -.035 },
  sleepy:        { eyeOpen: .62, browLift: -.025, smile: -.02, mouthCurve: .95,  mouthWidth: .96, tilt: -.025 },
  sad:           { eyeOpen: .8,  browLift: -.06,  smile: -.12, mouthCurve: -.82, mouthWidth: .98, tilt: -.04 },
  surprised:     { eyeOpen: 1.2, browLift: .105,  smile: .02,  mouthCurve: 1.3,   mouthWidth: .82, tilt: .015 },
  confused:      { eyeOpen: 1.02, browLift: .04,  smile: -.02, mouthCurve: -.25, mouthWidth: .98, tilt: .055 },
  annoyed:       { eyeOpen: .78, browLift: -.075, smile: -.14, mouthCurve: -.6,  mouthWidth: .94, tilt: -.02 },
  focused:       { eyeOpen: .88, browLift: -.045, smile: 0,    mouthCurve: .92,  mouthWidth: .98, tilt: 0 },
};

/**
 * Three.js portrait built from the supplied Quiet Observer geometry.
 * It intentionally uses Pulse's existing visualizer callback as its only frame loop.
 */
export class CharacterExperience {
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly stateElement: HTMLElement;
  private readonly renderer: any;
  private readonly scene: any;
  private readonly camera: any;
  private readonly character: any;
  private readonly body: any;
  private readonly upperBodyPivot: any;
  private readonly headPivot: any;
  private readonly mouthGroup: any;
  private readonly eyeRig: EyeRig[] = [];
  private readonly blinkMeshes: any[] = [];
  private readonly browMeshes: any[] = [];
  private readonly armPivots: Pivot[] = [];
  private readonly elbowPivots: Pivot[] = [];
  private readonly handPivots: Pivot[] = [];
  private readonly fingerPivots: FingerPivot[] = [];
  private readonly legPivots: Pivot[] = [];
  private readonly music = new MusicBehaviorController();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
  private readonly resizeObserver: ResizeObserver | null;
  private readonly intersectionObserver: IntersectionObserver | null;
  private readonly unsubscribeSettings: () => void;
  private readonly disposables = new Set<any>();
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly smoothPointer = new THREE.Vector2(0, 0);
  private readonly tapPointer = new THREE.Vector2();
  private readonly characterRaycaster = new THREE.Raycaster();
  private readonly idleGaze = new THREE.Vector2(0, 0);
  private readonly targetRotation = { y: -0.08 };
  private readonly themeLights: { hemi: any; key: any; fill: any; rim: any; warm: any; platform: any; rimMaterial: any; floorMaterial: any };
  private elapsed = 0;
  private visible = true;
  private disposed = false;
  private hovered = false;
  private dragging = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerLastX = 0;
  private dragDistance = 0;
  private clickTimes: number[] = [];
  private tapWaveAge = -1;
  private readonly tapWaveDuration = 2.9;
  private reactionAge = 10;
  private transitionReactionAge = 10;
  private lastTransition: CharacterDrive['transition'] = 'none';
  private expressionOverride: CharacterEmotion | null = null;
  private expressionOverrideUntil = 0;
  private reactionType: 'none' | 'click' | 'greeting' | 'confused' | 'annoyed' = 'none';
  private lastGreetingAt = -10;
  private idleGestureType: 'look' | 'shoulder' | 'shift' | 'adjust' = 'look';
  private idleGestureAge = -1;
  private idleGestureDuration = 1.25;
  private idleGestureWeight = 0;
  private nextIdleGesture = 8.5;
  private nextGlance = 6.5;
  private blinkAge = 0;
  private blinkDuration = 0;
  private nextBlink = 3.7;
  private blinkAmount = 0;
  private currentState: CharacterState = 'idle';
  private currentStyle = 'ambient';
  private activeDrive: CharacterDrive | null = null;
  private readonly expressionCurrent: ExpressionShape = { ...EXPRESSIONS.neutral };
  private readonly lookTarget = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement, stateElement: HTMLElement) {
    this.canvas = canvas;
    this.host = canvas.closest<HTMLElement>('.artwork-card') ?? canvas.parentElement ?? canvas;
    this.stateElement = stateElement;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    this.camera.position.set(0.12, 3.82, 14.2);
    this.camera.lookAt(0, 3.76, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const hemi = new THREE.HemisphereLight(0xcbd5e8, 0x29232a, 1.45);
    const key = new THREE.DirectionalLight(0xffe4ca, 2.35);
    key.position.set(-4.5, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3.2;
    key.shadow.camera.right = 3.2;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 22;
    key.shadow.bias = -0.00015;

    const fill = new THREE.DirectionalLight(0xa9badc, 1.2);
    fill.position.set(5, 4, 5);
    const rim = new THREE.DirectionalLight(0x8297c5, 2.35);
    rim.position.set(3.5, 5.5, -5);
    const warm = new THREE.PointLight(0xc99e78, 8, 9, 2);
    warm.position.set(-2.5, 2.2, 3.2);
    this.scene.add(hemi, key, fill, rim, warm);

    const toonRamp = new THREE.DataTexture(new Uint8Array([42, 42, 42, 104, 104, 104, 177, 177, 177, 244, 244, 244]), 4, 1, THREE.RedFormat);
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
    this.disposables.add(toonRamp);

    const toon = (color: string): any => this.trackMaterial(new THREE.MeshToonMaterial({ color, gradientMap: toonRamp }));
    const standard = (color: string, roughness = 0.7, metalness = 0): any => this.trackMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    const basic = (color: string, options: Record<string, unknown> = {}): any => this.trackMaterial(new THREE.MeshBasicMaterial({ color, ...options }));

    // Supplied model palette: warm skin, messy dark-brown hair, slate-grey eyes, black streetwear.
    const skin = toon('#e4bca8');
    const skinLight = toon('#edc9b6');
    const skinShade = toon('#b98376');
    const skinDark = toon('#80564f');
    const hairBase = toon('#30211d');
    const hairMid = toon('#422b24');
    const hairLight = toon('#614031');
    const hairDeep = toon('#20191a');
    const jacket = toon('#252a35');
    const jacketLight = toon('#353c49');
    const jacketDark = toon('#171b23');
    const shirt = toon('#e4dfd6');
    const pants = toon('#252a33');
    const pantsLight = toon('#343a45');
    const shoe = standard('#171b22', 0.63);
    const sole = standard('#555760', 0.83);
    const seam = basic('#626978');
    const eyeWhite = standard('#e9e7e2', 0.32);
    const iris = standard('#515a66', 0.24, 0.08);
    const irisInner = standard('#353d48', 0.28);
    const pupil = basic('#141a22');
    const glint = basic('#ffffff');
    const mouthMat = basic('#754f4b');
    const strandMat = this.trackMaterial(new THREE.MeshBasicMaterial({ color: '#8a6046', transparent: true, opacity: 0.42 }));

    this.character = new THREE.Group();
    this.scene.add(this.character);
    this.body = new THREE.Group();
    this.character.add(this.body);
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 6.48, 0);
    this.body.add(this.headPivot);

    const addMesh = (parent: any, geometry: any, material: any, position: number[] = [0, 0, 0], scale: number[] = [1, 1, 1], rotation: number[] = [0, 0, 0]): any => {
      this.disposables.add(geometry);
      const item = new THREE.Mesh(geometry, material);
      item.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
      item.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
      item.rotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0);
      item.castShadow = true;
      item.receiveShadow = true;
      parent.add(item);
      return item;
    };
    const ball = (parent: any, material: any, position: number[], scale: number[], segments = 32): any =>
      addMesh(parent, new THREE.SphereGeometry(1, segments, Math.max(16, Math.round(segments * 0.65))), material, position, scale);
    const link = (parent: any, material: any, a: number[], b: number[], radius: number, radial = 14, radiusEnd = radius): any => {
      const start = new THREE.Vector3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
      const end = new THREE.Vector3(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0);
      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      const group = new THREE.Group();
      group.position.copy(start).add(end).multiplyScalar(0.5);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      parent.add(group);
      addMesh(group, new THREE.CylinderGeometry(radiusEnd, radius, length, radial, 1), material);
      ball(group, material, [0, length / 2, 0], [radiusEnd, radiusEnd, radiusEnd], radial * 2);
      ball(group, material, [0, -length / 2, 0], [radius, radius, radius], radial * 2);
      return group;
    };
    const curveTube = (parent: any, points: number[][], radius: number, material: any, segments = 24, radial = 8): any => {
      const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)));
      return addMesh(parent, new THREE.TubeGeometry(curve, segments, radius, radial, false), material);
    };
    const ringBody = (parent: any, material: any, rings: number[][], radialSegments = 32): any => {
      const vertices: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      rings.forEach((ring, ringIndex) => {
        for (let j = 0; j <= radialSegments; j += 1) {
          const angle = (j / radialSegments) * Math.PI * 2;
          vertices.push(Math.sin(angle) * (ring[1] ?? 0), ring[0] ?? 0, (ring[3] ?? 0) + Math.cos(angle) * (ring[2] ?? 0));
          uvs.push(j / radialSegments, ringIndex / Math.max(1, rings.length - 1));
        }
      });
      for (let i = 0; i < rings.length - 1; i += 1) {
        for (let j = 0; j < radialSegments; j += 1) {
          const a = i * (radialSegments + 1) + j;
          const b = a + radialSegments + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return addMesh(parent, geometry, material);
    };
    const taperedLock = (parent: any, points: number[][], radius: number, material: any, sides = 9): any => {
      const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)));
      const steps = 18;
      const frames = curve.computeFrenetFrames(steps, false);
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const center = curve.getPointAt(t);
        const taper = Math.pow(1 - t, 0.72) * 0.94 + 0.025;
        const r = radius * taper * (0.92 + 0.08 * Math.sin(t * Math.PI));
        for (let j = 0; j <= sides; j += 1) {
          const angle = (j / sides) * Math.PI * 2;
          const p = center.clone()
            .addScaledVector(frames.normals[i], Math.cos(angle) * r)
            .addScaledVector(frames.binormals[i], Math.sin(angle) * r);
          positions.push(p.x, p.y, p.z);
        }
      }
      for (let i = 0; i < steps; i += 1) {
        for (let j = 0; j < sides; j += 1) {
          const a = i * (sides + 1) + j;
          const b = a + sides + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return addMesh(parent, geometry, material);
    };
    const roundedBox = (parent: any, material: any, position: number[], size: number[]): any => {
      const geometry = new THREE.BoxGeometry(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1, 3, 3, 3);
      geometry.computeVertexNormals();
      return addMesh(parent, geometry, material, position);
    };

    // Full-body legs are grouped at the hip so each side can participate in a small, coordinated sway.
    for (const side of [-1, 1]) {
      const x = side * 0.255;
      const leg = new THREE.Group();
      leg.position.set(x, 3.75, 0);
      this.body.add(leg);
      link(leg, pants, [x * 0.82 - x, 0, 0], [0, -1.70, 0.015], 0.205, 20, 0.165);
      ball(leg, pants, [0, -1.69, 0.01], [0.17, 0.22, 0.17], 24);
      link(leg, pants, [0, -1.73, 0.015], [x * 1.04 - x, -3.27, 0.025], 0.145, 20, 0.115);
      link(leg, pantsLight, [x * 1.04 - x, -3.21, 0.018], [x * 1.04 - x, -3.32, 0.018], 0.119, 20, 0.116);
      curveTube(leg, [[-side * 0.075, -1.00, 0.145], [-side * 0.07, -1.27, 0.16], [-side * 0.05, -1.55, 0.15]], 0.006, seam, 12, 5);
      ball(leg, shoe, [x * 1.04 - x, -3.50, 0.16], [0.19, 0.15, 0.34], 28);
      ball(leg, shoe, [x * 1.04 - x, -3.44, -0.035], [0.145, 0.14, 0.21], 24);
      roundedBox(leg, sole, [x * 1.04 - x, -3.615, 0.145], [0.365, 0.055, 0.56]);
      curveTube(leg, [[-0.10, -3.46, 0.31], [-0.07, -3.43, 0.20], [-0.05, -3.42, 0.05]], 0.008, seam, 14, 5);
      this.legPivots.push({ group: leg, side });
    }

    // Torso, shirt and tailored dark jacket retain the supplied silhouette and detailing.
    ringBody(this.body, pants, [[3.48, 0.39, 0.25, 0], [3.62, 0.46, 0.29, 0], [3.88, 0.43, 0.28, 0], [4.12, 0.39, 0.25, 0]], 36);
    ringBody(this.body, shirt, [[3.92, 0.34, 0.22, 0.005], [4.18, 0.39, 0.245, 0.005], [4.55, 0.43, 0.26, 0.005], [4.92, 0.45, 0.25, 0.005], [5.22, 0.48, 0.235, 0.005]], 40);
    ringBody(this.body, jacket, [[3.66, 0.43, 0.27, 0], [3.82, 0.49, 0.30, 0], [4.15, 0.47, 0.285, 0], [4.52, 0.49, 0.29, 0], [4.92, 0.57, 0.30, 0], [5.28, 0.66, 0.30, 0], [5.48, 0.59, 0.27, 0]], 40);
    ringBody(this.body, jacketDark, [[3.72, 0.445, 0.285, 0.015], [4.08, 0.475, 0.30, 0.015], [4.50, 0.48, 0.30, 0.015], [4.93, 0.55, 0.31, 0.015], [5.30, 0.63, 0.285, 0.015]], 40);
    roundedBox(this.body, shirt, [0, 4.56, 0.292], [0.34, 1.32, 0.035]);
    const lapelL = new THREE.Shape();
    lapelL.moveTo(-0.52, 5.34); lapelL.lineTo(-0.12, 5.08); lapelL.lineTo(-0.26, 4.72); lapelL.lineTo(-0.43, 4.98); lapelL.closePath();
    const lapelR = new THREE.Shape();
    lapelR.moveTo(0.52, 5.34); lapelR.lineTo(0.12, 5.08); lapelR.lineTo(0.26, 4.72); lapelR.lineTo(0.43, 4.98); lapelR.closePath();
    const lapels = standard('#303744', 0.86);
    addMesh(this.body, new THREE.ShapeGeometry(lapelL, 8), lapels, [0, 0, 0.34]);
    addMesh(this.body, new THREE.ShapeGeometry(lapelR, 8), lapels, [0, 0, 0.34]);
    curveTube(this.body, [[-0.47, 5.34, 0.28], [-0.26, 5.15, 0.37], [0, 5.07, 0.37], [0.26, 5.15, 0.37], [0.47, 5.34, 0.28]], 0.045, jacketLight, 30, 10);
    curveTube(this.body, [[-0.42, 3.82, 0.25], [-0.20, 3.79, 0.30], [0, 3.78, 0.305], [0.20, 3.79, 0.30], [0.42, 3.82, 0.25]], 0.018, jacketLight, 22, 7);
    curveTube(this.body, [[0, 4.0, 0.325], [0, 4.35, 0.33], [0, 4.72, 0.34], [0, 5.03, 0.33]], 0.007, seam, 24, 5);
    for (const side of [-1, 1]) {
      curveTube(this.body, [[side * 0.29, 4.20, 0.30], [side * 0.31, 4.02, 0.31], [side * 0.30, 3.90, 0.30]], 0.009, jacketLight, 12, 6);
      curveTube(this.body, [[side * 0.40, 4.67, 0.30], [side * 0.40, 4.48, 0.31], [side * 0.37, 4.38, 0.31]], 0.008, jacketDark, 12, 6);
    }
    curveTube(this.body, [[-0.19, 5.17, 0.31], [-0.12, 5.06, 0.35], [0, 5.03, 0.365], [0.12, 5.06, 0.35], [0.19, 5.17, 0.31]], 0.026, shirt, 22, 8);
    curveTube(this.body, [[-0.11, 5.03, 0.38], [0, 4.88, 0.40], [0.11, 5.03, 0.38]], 0.008, standard('#a78b6a', 0.35, 0.72), 18, 6);

    // Articulated shoulder, elbow, wrist and finger pivots make the tap greeting
    // read as a real wave instead of rotating the entire arm as one rigid piece.
    for (const side of [-1, 1]) {
      const upper = new THREE.Group();
      upper.position.set(side * 0.59, 5.23, 0);
      this.body.add(upper);
      link(upper, jacket, [0, 0, 0], [side * 0.20, -0.88, 0.015], 0.235, 22, 0.18);
      curveTube(upper, [[side * 0.12, -0.72, 0.16], [side * 0.20, -0.77, 0.17], [side * 0.28, -0.82, 0.13]], 0.009, jacketLight, 12, 6);

      const elbow = new THREE.Group();
      elbow.position.set(side * 0.20, -0.88, 0.015);
      upper.add(elbow);
      ball(elbow, jacket, [0, 0, 0], [0.185, 0.19, 0.18], 24);
      link(elbow, jacketLight, [0, 0, 0], [side * 0.05, -0.61, 0.04], 0.16, 20, 0.125);
      link(elbow, jacketDark, [side * 0.045, -0.55, 0.04], [side * 0.05, -0.65, 0.045], 0.132, 18, 0.128);

      const hand = new THREE.Group();
      hand.position.set(side * 0.05, -0.61, 0.04);
      elbow.add(hand);
      ball(hand, skin, [0, -0.15, 0.015], [0.115, 0.17, 0.105], 24);

      for (let index = 0; index < 4; index += 1) {
        const spread = (index - 1.5) * 0.047;
        const fingerLength = 0.17 - Math.abs(index - 1.5) * 0.018;
        const finger = new THREE.Group();
        finger.position.set(spread, -0.24, 0.045);
        hand.add(finger);
        link(finger, skinLight, [0, 0, 0], [side * 0.008, -fingerLength, 0.005], 0.023, 9, 0.018);
        this.fingerPivots.push({ group: finger, side, index });
      }

      const thumb = new THREE.Group();
      thumb.position.set(-side * 0.09, -0.13, 0.045);
      hand.add(thumb);
      link(thumb, skin, [0, 0, 0], [-side * 0.04, -0.13, 0.02], 0.027, 9, 0.021);
      this.fingerPivots.push({ group: thumb, side, index: 4 });

      this.armPivots.push({ group: upper, side });
      this.elbowPivots.push({ group: elbow, side });
      this.handPivots.push({ group: hand, side });
    }

    // Neck and collar.
    link(this.body, skin, [0, 5.32, 0], [0, 5.99, 0], 0.205, 24, 0.18);
    ringBody(this.body, shirt, [[5.30, 0.23, 0.20, 0], [5.42, 0.25, 0.21, 0], [5.53, 0.22, 0.19, 0]], 28);

    // Face base: the same tapered jaw profile as the supplied complete character.
    const makeHeadGeometry = (): any => {
      const profile = [
        [-0.75, 0.06, 0.16], [-0.68, 0.20, 0.27], [-0.55, 0.31, 0.34], [-0.36, 0.405, 0.385], [-0.12, 0.455, 0.405],
        [0.13, 0.465, 0.40], [0.37, 0.44, 0.385], [0.56, 0.385, 0.345], [0.70, 0.27, 0.27], [0.76, 0.08, 0.13],
      ];
      const stepsY = 64;
      const stepsA = 64;
      const vertices: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      const interp = (y: number, index: number): number => {
        let k = 0;
        while (k < profile.length - 2 && y > (profile[k + 1]?.[0] ?? 0)) k += 1;
        const a = profile[k] ?? profile[0] ?? [0, 0, 0];
        const b = profile[k + 1] ?? profile[profile.length - 1] ?? [1, 0, 0];
        const t = THREE.MathUtils.clamp((y - (a[0] ?? 0)) / ((b[0] ?? 1) - (a[0] ?? 0)), 0, 1);
        return THREE.MathUtils.lerp(a[index] ?? 0, b[index] ?? 0, t);
      };
      for (let i = 0; i <= stepsY; i += 1) {
        const y = THREE.MathUtils.lerp(-0.75, 0.76, i / stepsY);
        const w = interp(y, 1);
        const d = interp(y, 2);
        for (let j = 0; j <= stepsA; j += 1) {
          const a = (j / stepsA) * Math.PI * 2;
          vertices.push(Math.sin(a) * w, y, Math.cos(a) * d);
          uvs.push(j / stepsA, i / stepsY);
        }
      }
      for (let i = 0; i < stepsY; i += 1) {
        for (let j = 0; j < stepsA; j += 1) {
          const a = i * (stepsA + 1) + j;
          const b = a + stepsA + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    };
    addMesh(this.headPivot, makeHeadGeometry(), skin);

    for (const side of [-1, 1]) {
      ball(this.headPivot, skin, [side * 0.415, -0.27, 0.04], [0.115, 0.22, 0.22], 28);
      ball(this.headPivot, skin, [side * 0.455, -0.02, -0.015], [0.105, 0.19, 0.105], 24);
      ball(this.headPivot, skinShade, [side * 0.488, -0.025, 0.055], [0.035, 0.105, 0.045], 18);
      ball(this.headPivot, skin, [side * 0.455, 0.07, 0.02], [0.13, 0.20, 0.10], 24);
    }

    // Eyes: grey iris, pupil, catchlights and curved eyelids.
    for (const side of [-1, 1]) {
      const x = side * 0.205;
      ball(this.headPivot, skinShade, [x, -0.005, 0.348], [0.177, 0.112, 0.045], 28);
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(x, -0.035, 0.375);
      this.headPivot.add(eyeGroup);
      ball(eyeGroup, eyeWhite, [0, 0, 0], [0.147, 0.078, 0.042], 32);
      ball(eyeGroup, iris, [side * 0.008, -0.002, 0.036], [0.060, 0.066, 0.022], 28);
      ball(eyeGroup, irisInner, [side * 0.008, -0.006, 0.052], [0.034, 0.045, 0.012], 24);
      ball(eyeGroup, pupil, [side * 0.008, -0.004, 0.062], [0.023, 0.034, 0.008], 20);
      ball(eyeGroup, glint, [-0.014, 0.025, 0.071], [0.013, 0.014, 0.007], 16);
      ball(eyeGroup, glint, [0.025, -0.018, 0.069], [0.006, 0.007, 0.004], 12);
      curveTube(eyeGroup, [[-0.15, -0.005, 0.025], [-0.09, 0.060, 0.038], [0, 0.073, 0.042], [0.09, 0.054, 0.035], [0.15, -0.006, 0.02]], 0.014, skinDark, 22, 7);
      curveTube(eyeGroup, [[-0.14, -0.008, 0.024], [-0.075, -0.055, 0.032], [0, -0.066, 0.034], [0.075, -0.052, 0.03], [0.14, -0.008, 0.02]], 0.008, skinShade, 20, 6);
      curveTube(eyeGroup, [[-0.135, 0.012, 0.031], [-0.08, 0.068, 0.04], [0, 0.081, 0.044], [0.09, 0.064, 0.038], [0.14, 0.008, 0.025]], 0.005, hairDeep, 20, 5);
      this.eyeRig.push({ group: eyeGroup, irisMeshes: eyeGroup.children.slice(1, 5) });
      this.blinkMeshes.push(eyeGroup);

      const brow = curveTube(this.headPivot, [[x - side * 0.145, 0.145, 0.386], [x - side * 0.08, 0.178, 0.402], [x, 0.185, 0.405], [x + side * 0.09, 0.16, 0.39], [x + side * 0.145, 0.135, 0.37]], 0.022, hairBase, 20, 8);
      this.browMeshes.push(brow);
    }

    // Nose and the separate mouth group allow low-amplitude expression changes.
    ball(this.headPivot, skinLight, [0, -0.10, 0.388], [0.052, 0.16, 0.067], 24);
    ball(this.headPivot, skin, [0, -0.205, 0.435], [0.083, 0.064, 0.065], 24);
    ball(this.headPivot, skinShade, [-0.052, -0.225, 0.421], [0.026, 0.018, 0.017], 16);
    ball(this.headPivot, skinShade, [0.052, -0.225, 0.421], [0.026, 0.018, 0.017], 16);
    this.mouthGroup = new THREE.Group();
    this.mouthGroup.position.set(0, -0.405, 0.366);
    this.headPivot.add(this.mouthGroup);
    curveTube(this.mouthGroup, [[-0.092, 0, 0], [-0.045, 0.008, 0.006], [0, 0.002, 0.008], [0.045, 0.008, 0.006], [0.092, 0, 0]], 0.009, mouthMat, 18, 6);
    curveTube(this.mouthGroup, [[-0.065, -0.018, 0.002], [0, -0.026, 0.012], [0.065, -0.018, 0.002]], 0.012, skinShade, 14, 6);

    // Dark-brown cap and layered locks preserve the fluffy, medium-short hairstyle.
    ball(this.headPivot, hairBase, [0, 0.43, -0.055], [0.49, 0.40, 0.455], 48);
    ball(this.headPivot, hairDeep, [0, 0.12, -0.335], [0.405, 0.49, 0.17], 36);
    const backLocks = [
      [[-0.34, 0.48, -0.26], [-0.48, 0.24, -0.43], [-0.43, -0.18, -0.39]],
      [[-0.16, 0.58, -0.32], [-0.23, 0.25, -0.49], [-0.19, -0.31, -0.43]],
      [[0.12, 0.58, -0.32], [0.22, 0.25, -0.49], [0.19, -0.31, -0.43]],
      [[0.34, 0.46, -0.26], [0.48, 0.20, -0.43], [0.43, -0.18, -0.39]],
      [[-0.05, 0.67, -0.20], [-0.12, 0.47, -0.47], [-0.10, 0.05, -0.50]],
      [[0.15, 0.66, -0.20], [0.24, 0.43, -0.45], [0.24, 0.02, -0.49]],
    ];
    backLocks.forEach((points, index) => taperedLock(this.headPivot, points, 0.18, index % 2 ? hairMid : hairBase, 10));
    const topLocks = [
      [[-0.37, 0.43, -0.02], [-0.52, 0.71, -0.08], [-0.62, 0.84, -0.18]],
      [[-0.22, 0.52, 0.01], [-0.34, 0.79, -0.02], [-0.36, 0.94, -0.12]],
      [[-0.02, 0.57, -0.02], [-0.08, 0.84, -0.07], [-0.02, 1.00, -0.16]],
      [[0.18, 0.53, -0.04], [0.29, 0.78, -0.10], [0.39, 0.91, -0.18]],
      [[0.36, 0.39, -0.05], [0.50, 0.63, -0.10], [0.60, 0.75, -0.19]],
      [[-0.40, 0.22, -0.06], [-0.59, 0.42, -0.12], [-0.67, 0.56, -0.19]],
      [[0.40, 0.22, -0.06], [0.58, 0.39, -0.12], [0.66, 0.52, -0.19]],
    ];
    topLocks.forEach((points, index) => taperedLock(this.headPivot, points, 0.16, index % 3 === 0 ? hairLight : hairMid, 10));
    const fringe = [
      [[-0.40, 0.47, 0.26], [-0.42, 0.12, 0.43], [-0.35, -0.19, 0.44]],
      [[-0.28, 0.55, 0.29], [-0.26, 0.24, 0.48], [-0.18, -0.15, 0.49]],
      [[-0.10, 0.58, 0.29], [-0.08, 0.26, 0.50], [-0.02, -0.22, 0.51]],
      [[0.09, 0.55, 0.28], [0.12, 0.25, 0.49], [0.18, -0.16, 0.48]],
      [[0.28, 0.48, 0.25], [0.34, 0.17, 0.44], [0.39, -0.11, 0.42]],
      [[0.42, 0.36, 0.18], [0.49, 0.16, 0.33], [0.53, 0.00, 0.31]],
    ];
    fringe.forEach((points, index) => taperedLock(this.headPivot, points, 0.14, index % 2 ? hairBase : hairMid, 10));
    taperedLock(this.headPivot, [[-0.43, 0.26, 0.12], [-0.50, -0.06, 0.20], [-0.47, -0.44, 0.13]], 0.145, hairBase, 10);
    taperedLock(this.headPivot, [[0.43, 0.26, 0.12], [0.50, -0.06, 0.20], [0.47, -0.42, 0.13]], 0.145, hairMid, 10);
    taperedLock(this.headPivot, [[-0.38, -0.03, 0.12], [-0.43, -0.30, 0.17], [-0.39, -0.53, 0.08]], 0.105, hairLight, 9);
    taperedLock(this.headPivot, [[0.38, -0.03, 0.12], [0.43, -0.30, 0.17], [0.39, -0.52, 0.08]], 0.105, hairBase, 9);
    curveTube(this.headPivot, [[-0.31, 0.62, 0.23], [-0.24, 0.43, 0.39], [-0.22, 0.17, 0.47]], 0.006, strandMat, 18, 5);
    curveTube(this.headPivot, [[-0.08, 0.72, 0.25], [-0.02, 0.48, 0.43], [0.01, 0.24, 0.49]], 0.005, strandMat, 18, 5);
    curveTube(this.headPivot, [[0.20, 0.60, 0.23], [0.26, 0.40, 0.39], [0.30, 0.18, 0.44]], 0.006, strandMat, 18, 5);

    // A small studio disc anchors the feet without obscuring the app's artwork rings.
    const floorMaterial = standard('#151923', 0.9, 0.05);
    const floor = addMesh(this.scene, new THREE.CircleGeometry(2.4, 72), floorMaterial, [0, -0.035, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
    floor.receiveShadow = true;
    const platformMaterial = standard('#1d222d', 0.72, 0.18);
    const platform = addMesh(this.scene, new THREE.CylinderGeometry(0.74, 0.80, 0.055, 72), platformMaterial, [0, 0.025, 0]);
    platform.castShadow = true;
    platform.receiveShadow = true;
    const rimMaterial = basic('#626d83');
    const rimRing = addMesh(this.scene, new THREE.TorusGeometry(0.77, 0.009, 8, 96), rimMaterial, [0, 0.06, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    rimRing.castShadow = false;

    // The supplied full-body proportions put the soles slightly above the platform.
    this.character.position.set(0, -0.05, 0);
    this.character.scale.set(1.16, 1.0, 1.0);

    // Keep the legs rooted at the hips while the chest/shoulders can sway as one unit.
    // Object3D.attach preserves the meshes' world transforms as they move under this pivot.
    const upperBodyPivot = new THREE.Group();
    upperBodyPivot.position.set(0, 3.72, 0);
    this.body.add(upperBodyPivot);
    this.body.updateMatrixWorld(true);
    upperBodyPivot.updateMatrixWorld(true);
    const legRoots = new Set(this.legPivots.map(({ group }) => group));
    for (const child of [...this.body.children]) {
      if (child !== upperBodyPivot && !legRoots.has(child)) upperBodyPivot.attach(child);
    }
    this.upperBodyPivot = upperBodyPivot;

    this.themeLights = { hemi, key, fill, rim, warm, platform: platformMaterial, rimMaterial, floorMaterial };

    this.resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(this.canvas);
    window.addEventListener('resize', this.resize, { passive: true });
    this.systemThemeQuery.addEventListener('change', this.onSystemThemeChange);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('lostpointercapture', this.onPointerCancel);
    this.canvas.addEventListener('pointerenter', this.onPointerEnter);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
        const entry = entries[0];
        this.visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.05);
      }, { threshold: [0, 0.05, 0.25] })
      : null;
    this.intersectionObserver?.observe(this.canvas);

    this.unsubscribeSettings = settings.subscribe(() => this.applyTheme(currentPalette()));
    this.applyTheme(currentPalette());
    this.resize();
    this.host.classList.add('has-character');
    this.canvas.dataset.ready = 'true';
  }

  /** Temporarily apply an explicit expression for contextual events outside audio analysis. */
  setExpression(emotion: CharacterEmotion, durationSeconds = 2): void {
    this.expressionOverride = emotion;
    this.expressionOverrideUntil = this.elapsed + clamp(durationSeconds, 0.15, 20);
  }

  update(frame: AudioFrame, dt: number, sourceActive: boolean): void {
    if (this.disposed) return;
    const step = Math.min(0.05, Math.max(0.001, dt));
    this.elapsed += step;
    const drive = this.music.update(frame, step, sourceActive, settings.get().characterVibe);
    if (drive.transition !== 'none' && this.lastTransition === 'none') this.transitionReactionAge = 0;
    else this.transitionReactionAge += step;
    this.lastTransition = drive.transition;
    this.activeDrive = drive;

    if (drive.state !== this.currentState || drive.style !== this.currentStyle) {
      this.currentState = drive.state;
      this.currentStyle = drive.style;
      this.stateElement.textContent = drive.active
        ? `${stateLabel(drive.state)} · ${styleLabel(drive.style)}`
        : stateLabel(drive.state);
      this.stateElement.dataset.state = drive.state;
      this.stateElement.title = drive.bpm && drive.tempoConfidence > 0.35
        ? `Approx. ${Math.round(drive.bpm)} BPM from recent beat onsets; this is a rhythm estimate, not track metadata`
        : 'Movement style is estimated from audio energy and beat timing; no genre is claimed';
    }

    this.updateInteraction(step);
    this.updateBlink(step);
    this.updateExpression(drive, step);
    this.updateMovement(drive, step);
    if (!this.visible || document.hidden) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSettings();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    this.systemThemeQuery.removeEventListener('change', this.onSystemThemeChange);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.canvas.removeEventListener('pointerenter', this.onPointerEnter);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.dispose();
    this.disposables.forEach((item) => item.dispose?.());
    this.host.classList.remove('has-character');
    delete this.canvas.dataset.ready;
  }

  private trackMaterial(material: any): any {
    this.disposables.add(material);
    return material;
  }

  private applyTheme(palette: ReturnType<typeof currentPalette>): void {
    this.themeLights.hemi.color.set(palette.isLight ? '#eaf0f8' : '#cbd5e8');
    this.themeLights.hemi.groundColor.set(palette.isLight ? '#9eabbc' : '#29232a');
    this.themeLights.hemi.intensity = palette.isLight ? 1.2 : 1.45;
    this.themeLights.key.color.set(palette.isLight ? palette.accent2 : '#ffe4ca');
    this.themeLights.key.intensity = palette.isLight ? 2.5 : 2.35;
    this.themeLights.fill.color.set(palette.accent);
    this.themeLights.fill.intensity = palette.isLight ? 1.0 : 1.2;
    this.themeLights.rim.color.set(palette.accent2);
    this.themeLights.rim.intensity = palette.isLight ? 2.0 : 2.35;
    this.themeLights.warm.color.set(palette.isLight ? '#c99e78' : '#c99e78');
    this.themeLights.warm.intensity = palette.isLight ? 5 : 8;
    this.themeLights.platform.color.set(palette.isLight ? '#d4d9e1' : '#1d222d');
    this.themeLights.rimMaterial.color.set(palette.accent2);
    this.themeLights.floorMaterial.color.set(palette.isLight ? '#e8ebef' : '#151923');
  }

  private onSystemThemeChange = (): void => {
    if (settings.get().mode === 'system') this.applyTheme(currentPalette());
  };

  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 280));
    const height = Math.max(1, Math.round(rect.height || 280));
    this.camera.aspect = width / height;
    this.camera.position.set(0.12, 3.82, 14.2);
    this.camera.lookAt(0, 3.76, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 260 ? 1.25 : 1.5));
    this.renderer.setSize(width, height, false);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      this.pointer.set(clamp(x * 2 - 1, -1.15, 1.15), clamp(1 - y * 2, -1.15, 1.15));
      this.hovered = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    }
    if (this.dragging) {
      const dx = event.clientX - this.pointerLastX;
      this.targetRotation.y += dx * 0.008;
      this.dragDistance += Math.abs(dx);
      this.pointerLastX = event.clientX;
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.dragging = true;
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
    this.pointerLastX = event.clientX;
    this.dragDistance = 0;
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const distance = Math.hypot(event.clientX - this.pointerStartX, event.clientY - this.pointerStartY);
    this.dragging = false;
    if (distance < 7 && this.dragDistance < 7 && this.hitCharacter(event.clientX, event.clientY)) {
      this.reactToClick();
    }
  };

  /** A tap only greets when the ray actually intersects the character, not the empty artwork. */
  private hitCharacter(clientX: number, clientY: number): boolean {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    this.tapPointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.characterRaycaster.setFromCamera(this.tapPointer, this.camera);
    return this.characterRaycaster.intersectObject(this.character, true).length > 0;
  }

  private onPointerCancel = (): void => {
    this.dragging = false;
  };

  private onPointerEnter = (): void => {
    if (!this.hovered && this.elapsed - this.lastGreetingAt > 7.5) {
      this.reactionType = 'greeting';
      this.reactionAge = 0;
      this.lastGreetingAt = this.elapsed;
    }
    this.hovered = true;
  };

  private onPointerLeave = (): void => {
    if (!this.dragging) this.hovered = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      this.targetRotation.y += event.key === 'ArrowLeft' ? -0.18 : 0.18;
    } else if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      this.targetRotation.y = -0.08;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.reactToClick();
    }
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
  };

  private reactToClick(): void {
    this.tapWaveAge = 0;
    this.idleGestureAge = -1;
    this.idleGestureWeight = 0;
    this.nextIdleGesture = this.elapsed + 8 + Math.random() * 6;
    this.clickTimes = this.clickTimes.filter((time) => this.elapsed - time < 1.25);
    this.clickTimes.push(this.elapsed);
    this.reactionAge = 0;
    if (this.clickTimes.length >= 4) {
      this.reactionType = 'annoyed';
      this.clickTimes.length = 0;
    } else if (this.clickTimes.length >= 2) {
      this.reactionType = 'confused';
    } else {
      this.reactionType = 'click';
    }
  }

  private updateInteraction(dt: number): void {
    this.reactionAge += dt;
    if (this.tapWaveAge >= 0) {
      this.tapWaveAge += dt;
      if (this.tapWaveAge >= this.tapWaveDuration) this.tapWaveAge = -1;
    }
    if (this.reactionAge > 1.25) this.reactionType = 'none';

    if (this.elapsed >= this.nextGlance) {
      this.idleGaze.set((Math.random() - 0.5) * 0.48, (Math.random() - 0.5) * 0.24);
      this.nextGlance = this.elapsed + 4.0 + Math.random() * 5.5;
    }

    // Occasional low-amplitude gestures keep him from holding one identical idle pose.
    // They only run in silence and never compete with music or direct user interaction.
    if (this.activeDrive?.active) {
      this.idleGestureAge = -1;
      this.idleGestureWeight = 0;
    }
    if (!this.activeDrive?.active && !this.hovered && this.reactionType === 'none' && this.idleGestureAge < 0 && this.elapsed >= this.nextIdleGesture) {
      const gestures = ['look', 'shoulder', 'shift', 'adjust'] as const;
      this.idleGestureType = gestures[Math.floor(Math.random() * gestures.length)] ?? 'look';
      this.idleGestureAge = 0;
      this.idleGestureDuration = 0.95 + Math.random() * 0.65;
      this.nextIdleGesture = this.elapsed + 7.5 + Math.random() * 7.5;
    }
    if (this.idleGestureAge >= 0) {
      this.idleGestureAge += dt;
      const progress = clamp(this.idleGestureAge / this.idleGestureDuration, 0, 1);
      this.idleGestureWeight = Math.sin(progress * Math.PI);
      if (progress >= 1) {
        this.idleGestureAge = -1;
        this.idleGestureWeight = 0;
      }
    } else {
      this.idleGestureWeight = 0;
    }

    const targetX = this.hovered ? this.pointer.x : this.idleGaze.x;
    const targetY = this.hovered ? this.pointer.y : this.idleGaze.y;
    this.lookTarget.set(clamp(targetX, -0.8, 0.8), clamp(targetY, -0.55, 0.55));
    this.smoothPointer.lerp(this.lookTarget, 1 - Math.exp(-dt * (this.hovered ? 6.5 : 1.8)));
  }

  private updateBlink(dt: number): void {
    this.blinkAge += dt;
    if (this.blinkDuration > 0) {
      const progress = this.blinkAge / this.blinkDuration;
      this.blinkAmount = progress < 0.42
        ? clamp(progress / 0.42, 0, 1)
        : 1 - clamp((progress - 0.42) / 0.58, 0, 1);
      if (progress >= 1) {
        this.blinkDuration = 0;
        this.blinkAge = 0;
        this.blinkAmount = 0;
        this.nextBlink = this.elapsed + 3.0 + Math.random() * 3.8;
      }
    } else if (this.elapsed >= this.nextBlink) {
      this.blinkAge = 0;
      this.blinkDuration = 0.20 + Math.random() * 0.05;
    }
    if (this.activeDrive?.emotion === 'sleepy' && this.blinkDuration === 0 && this.elapsed > this.nextBlink + 1.8) {
      this.blinkAge = 0;
      this.blinkDuration = 0.35;
    }
  }

  private updateExpression(drive: CharacterDrive, dt: number): void {
    if (this.expressionOverride && this.elapsed >= this.expressionOverrideUntil) this.expressionOverride = null;
    let emotion = this.expressionOverride ?? drive.emotion;
    if (this.tapWaveAge >= 0 || this.reactionType === 'click') emotion = 'happy';
    else if (this.reactionType === 'greeting') emotion = 'subtle-smile';
    else if (this.reactionType === 'confused') emotion = 'confused';
    else if (this.reactionType === 'annoyed') emotion = 'annoyed';
    else if (!this.expressionOverride && this.hovered && !drive.active) emotion = 'curious';
    else if (!this.expressionOverride && this.transitionReactionAge < 0.52 && drive.transition === 'build') emotion = 'excited';
    const target = EXPRESSIONS[emotion];
    const rate = 1 - Math.exp(-dt * 4.5);
    for (const key of EXPRESSION_KEYS) {
      this.expressionCurrent[key] += (target[key] - this.expressionCurrent[key]) * rate;
    }
    const blink = this.blinkAmount;
    const eyeOpen = this.expressionCurrent.eyeOpen;
    for (const eye of this.blinkMeshes) eye.scale.y = Math.max(0.06, eyeOpen * (1 - blink * 0.94));
    for (const [index, brow] of this.browMeshes.entries()) {
      const asymmetry = emotion === 'confused' && index === 0 ? 0.055 : 0;
      brow.position.y = this.expressionCurrent.browLift + asymmetry;
      brow.rotation.z = index === 0 ? -this.expressionCurrent.browLift * 0.12 : this.expressionCurrent.browLift * 0.12;
    }
    this.mouthGroup.scale.set(this.expressionCurrent.mouthWidth, this.expressionCurrent.mouthCurve, 1);
    this.mouthGroup.position.y = -0.405 + this.expressionCurrent.smile * 0.014;
  }

  private updateMovement(drive: CharacterDrive, dt: number): void {
    const reduced = this.reducedMotion ? 0.42 : 1;
    const reactivity = settings.get().reactivity;
    const energy = drive.active ? drive.energy : 0;
    const beat = drive.beat;
    const bass = drive.bass;
    const style = STYLE_MOTION_SCALE[drive.style];
    const activity = (0.18 + energy * 0.82) * style * reactivity * reduced;
    const idleFactor = drive.active ? 1 : 0.42;
    const breath = Math.sin(this.elapsed * 1.42) * 0.008 * reduced;
    const groovePhase = this.elapsed * (drive.bpm ? (drive.bpm / 60) * Math.PI : 1.7);
    const wave = Math.sin(groovePhase);
    const counterWave = Math.sin(groovePhase * 0.5 + 0.8);
    const drop = drive.transition === 'drop' ? drive.transitionStrength : 0;
    const build = drive.transition === 'build' ? drive.transitionStrength : 0;
    const greeting = this.reactionType === 'greeting'
      ? Math.sin(Math.PI * clamp(this.reactionAge / 1.12, 0, 1)) : 0;
    const click = this.reactionType === 'click'
      ? Math.sin(Math.PI * clamp(this.reactionAge / 0.92, 0, 1)) : 0;
    const idleLook = this.idleGestureType === 'look' ? this.idleGestureWeight : 0;
    const idleShoulder = this.idleGestureType === 'shoulder' ? this.idleGestureWeight : 0;
    const idleShift = this.idleGestureType === 'shift' ? this.idleGestureWeight : 0;
    const idleAdjust = this.idleGestureType === 'adjust' ? this.idleGestureWeight : 0;

    // The pelvis, chest and head move as one phrase, with subtle counter-rotation.
    const targetBodyX = wave * 0.048 * activity + counterWave * 0.014 * idleFactor
      + Math.sin(this.elapsed * 1.6) * idleShift * 0.012;
    const targetBodyY = breath + beat * 0.022 * activity + build * 0.009 + click * 0.009;
    const targetBodyZ = wave * 0.018 * activity + (this.hovered ? 0.008 : 0) + idleShift * 0.012;
    const targetChestZ = wave * 0.032 * activity + beat * 0.009 * activity + idleShoulder * 0.02 + click * 0.012;
    const targetChestX = counterWave * 0.012 * activity + drive.mid * 0.012 * activity;
    const targetChestY = (this.hovered ? this.pointer.x * 0.022 : 0) + idleLook * 0.018;
    this.body.position.x += (targetBodyX - this.body.position.x) * (1 - Math.exp(-dt * 3.8));
    this.body.position.y += (targetBodyY - this.body.position.y) * (1 - Math.exp(-dt * 5.5));
    this.body.rotation.z += (targetBodyZ - this.body.rotation.z) * (1 - Math.exp(-dt * 3.4));
    this.body.rotation.x += ((drive.treble * 0.008 * activity - this.body.rotation.x) * (1 - Math.exp(-dt * 3)));
    this.upperBodyPivot.rotation.z += (targetChestZ - this.upperBodyPivot.rotation.z) * (1 - Math.exp(-dt * 3.5));
    this.upperBodyPivot.rotation.x += (targetChestX - this.upperBodyPivot.rotation.x) * (1 - Math.exp(-dt * 3.2));
    this.upperBodyPivot.rotation.y += (targetChestY - this.upperBodyPivot.rotation.y) * (1 - Math.exp(-dt * 3.1));

    this.character.rotation.y += (this.targetRotation.y - this.character.rotation.y) * (1 - Math.exp(-dt * 3.2));
    const gazeX = this.smoothPointer.x * 0.12;
    const gazeY = -this.smoothPointer.y * 0.085;
    const nod = -beat * 0.043 * activity - bass * 0.016 * activity;
    const headTilt = this.expressionCurrent.tilt + wave * 0.018 * activity
      + this.smoothPointer.x * 0.025 + idleLook * 0.04;
    this.headPivot.rotation.y += (gazeX - this.headPivot.rotation.y) * (1 - Math.exp(-dt * 5.2));
    this.headPivot.rotation.x += ((gazeY + nod + drop * 0.03) - this.headPivot.rotation.x) * (1 - Math.exp(-dt * 4.6));
    this.headPivot.rotation.z += (headTilt - this.headPivot.rotation.z) * (1 - Math.exp(-dt * 3.8));

    // A tap greeting follows the supplied animation: lift the right arm beside
    // the head, fold at the elbow, then wave the palm and individual fingers.
    const waveProgress = this.tapWaveAge >= 0 ? clamp(this.tapWaveAge / this.tapWaveDuration, 0, 1) : 1;
    const waveRise = this.tapWaveAge >= 0 ? clamp(waveProgress / 0.18, 0, 1) : 1;
    const waveFall = this.tapWaveAge >= 0 ? 1 - clamp((waveProgress - 0.78) / 0.22, 0, 1) : 0;
    const waveLift = this.tapWaveAge >= 0
      ? Math.min(waveRise * waveRise * (3 - 2 * waveRise), waveFall * waveFall * (3 - 2 * waveFall))
        * (this.reducedMotion ? 0.72 : 1)
      : 0;
    const waveTime = Math.max(0, this.tapWaveAge) * (this.reducedMotion ? 8.2 : 10.8);

    const armSwing = wave * 0.14 * activity + beat * 0.06 * activity + drive.snap * 0.022;
    const shoulderLift = (drive.style === 'ambient' || drive.style === 'lofi' ? -0.018 : 0.018) * activity;
    for (const arm of this.armPivots) {
      const side = arm.side;
      const raisedGesture = side > 0 ? greeting * 0.48 + click * 0.24 + idleAdjust * 0.15 : 0;
      const waveGesture = side > 0 ? greeting * Math.sin(this.elapsed * 17) * 0.075 : 0;
      let targetArmZ = side * (shoulderLift + armSwing * 0.36 + idleShoulder * 0.035) + raisedGesture;
      let targetArmX = Math.sin(groovePhase + side * 0.6) * 0.065 * activity
        + drive.snap * 0.03 + waveGesture + (side > 0 ? click * 0.025 : 0);
      if (side > 0 && waveLift > 0) {
        targetArmZ = 1.52 * waveLift;
        targetArmX = -0.075 * waveLift;
      }
      arm.group.rotation.z += (targetArmZ - arm.group.rotation.z) * (1 - Math.exp(-dt * (waveLift > 0 ? 7.5 : 4.5)));
      arm.group.rotation.x += (targetArmX - arm.group.rotation.x) * (1 - Math.exp(-dt * 4));
    }

    for (const elbow of this.elbowPivots) {
      const target = elbow.side > 0 ? 1.23 * waveLift : 0;
      elbow.group.rotation.z += (target - elbow.group.rotation.z) * (1 - Math.exp(-dt * (waveLift > 0 && elbow.side > 0 ? 8 : 5)));
    }

    for (const hand of this.handPivots) {
      const waving = hand.side > 0 && waveLift > 0;
      const targetZ = waving ? Math.sin(waveTime) * 0.48 * waveLift : 0;
      const targetX = waving ? 0.08 * waveLift + Math.sin(waveTime * 0.5) * 0.07 * waveLift : 0;
      hand.group.rotation.z += (targetZ - hand.group.rotation.z) * (1 - Math.exp(-dt * 12));
      hand.group.rotation.x += (targetX - hand.group.rotation.x) * (1 - Math.exp(-dt * 9));
    }

    for (const finger of this.fingerPivots) {
      const waving = finger.side > 0 && waveLift > 0;
      const fingerPhase = waveTime + finger.index * 0.42;
      const targetZ = waving ? Math.sin(fingerPhase) * 0.105 * waveLift : 0;
      const targetX = waving ? Math.cos(fingerPhase * 0.72) * 0.035 * waveLift : 0;
      finger.group.rotation.z += (targetZ - finger.group.rotation.z) * (1 - Math.exp(-dt * 14));
      finger.group.rotation.x += (targetX - finger.group.rotation.x) * (1 - Math.exp(-dt * 12));
    }

    // Small foot/hip accents make rhythmic motion travel through the whole silhouette.
    const legSwing = wave * 0.06 * activity + beat * 0.024 * activity + idleShift * 0.018;
    for (const leg of this.legPivots) {
      leg.group.rotation.x += ((legSwing * leg.side) - leg.group.rotation.x) * (1 - Math.exp(-dt * 3.5));
      leg.group.rotation.z += ((-leg.side * wave * 0.018 * activity) - leg.group.rotation.z) * (1 - Math.exp(-dt * 3.2));
    }

    // Keep iris travel inside the eye opening; no eye group is moved independently of its socket.
    for (const eye of this.eyeRig) {
      for (const irisMesh of eye.irisMeshes) {
        irisMesh.position.x += (this.smoothPointer.x * 0.013 - irisMesh.position.x) * (1 - Math.exp(-dt * 8));
        irisMesh.position.y += (this.smoothPointer.y * 0.010 - irisMesh.position.y) * (1 - Math.exp(-dt * 8));
      }
    }
  }
}
