import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Clock,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  Line,
  LineBasicMaterial,
  LoadingManager,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import type { Material, MeshStandardMaterial, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BombEvent, DroppedEquipment, NadeEvent, NadeTrajectoryPoint, PlayerFrame, ReplayData } from '$lib/types/replay/replay_pb';
import { getWeaponIconPath } from '$lib/equipment-icons';
import { frameAt, indexFrames, lerpAngleDegrees, type FrameIndex } from '$lib/replay';
import { getRoundDisplayEndTick, getRoundForTick } from '$lib/replay/rounds';
import { SOURCE_UNIT_METERS, sourceToThree, sourceViewDirection } from './coordinates';

export type CameraMode = 'free' | 'player';

const CT_COLOR = 0x62aef7;
const T_COLOR = 0xe7a451;
const DEAD_COLOR = 0x8d949c;
const HEALTH_GREEN = 0x35f28a;
const HEALTH_ORANGE = 0xffa52f;
const HEALTH_RED = 0xff4d5e;
const BOMB_PLANTED_COLOR = 0xf97316;
const BOMB_DEFUSED_COLOR = 0x8d949c;
const BOMB_EXPLODED_COLOR = 0xef3340;
const BOMB_MARKER_RADIUS = 9 * SOURCE_UNIT_METERS;
const DEFAULT_BOMB_TIME_SECONDS = 40;
const DEFUSE_SECONDS_WITH_KIT = 5;
const DEFUSE_SECONDS_WITHOUT_KIT = 10;
const BOMB_LABEL_HEIGHT = 0.85;
const BOMB_PRIMARY_LABEL_OFFSET = 1.35;
const BOMB_SECONDARY_LABEL_OFFSET = 0.42;
const PLAYER_NAME_LABEL_HEIGHT = 0.32;
const PLAYER_WEAPON_LABEL_HEIGHT = 0.27;
const PLAYER_NAME_LABEL_OFFSET = 0.7;
const PLAYER_WEAPON_LABEL_OFFSET = 0.38;
const PLAYER_INVENTORY_ICON_SIZE = 0.3;
const PLAYER_INVENTORY_ICON_GAP = 0.06;
const PLAYER_INVENTORY_OFFSET = 1.04;
const DROPPED_EQUIPMENT_ICON_SIZE = 0.62;
const DROPPED_EQUIPMENT_HEIGHT_OFFSET = 0.32;
const ROUND_CARRYOVER_DETECTION_TICKS = 16;
const ROUND_CARRYOVER_POSITION_DISTANCE_SQUARED = 64 * 64;
const LOS_MAX_DISTANCE_METERS = 300;
const LOS_RAYCAST_INTERVAL_MS = 500;
const LOS_GLOBAL_INTERVAL_MS = 100;
const COLLIDER_CELL_SIZE_METERS = 12;
const MAX_CELLS_PER_COLLIDER = 512;
const MOUSE_LOOK_SENSITIVITY = 0.0022;

const UTILITY_COLORS: Record<string, number> = {
  smoke: 0x858b91,
  flashbang: 0xffdf3a,
  hegrenade: 0xff8c24,
  molotov: 0xe3483e,
  incendiary: 0xe3483e,
  decoy: 0x8b5a2b
};

const SOLID_PHYSICS_NAMES = new Set([
  'func_brush',
  'func_clip_vphysics',
  'prop_door_rotating',
  'prop_dynamic',
  'prop_physics_multiplayer'
]);

interface PlayerVisual {
  body: Mesh<CapsuleGeometry, MeshBasicMaterial>;
  healthBar: Group;
  healthFill: Mesh<PlaneGeometry, MeshBasicMaterial>;
  nameLabel: Sprite;
  weaponLabel: Sprite;
  inventory: Group;
  inventoryKey: string;
  sightLine: Mesh<CylinderGeometry, MeshBasicMaterial>;
  eye: Vector3;
  direction: Vector3;
  sightDistance: number;
  alive: boolean;
  lastSightUpdate: number;
}

interface DroppedEquipmentVisual {
  item: DroppedEquipment;
  icon: Sprite;
}

interface UtilityVisual {
  nade: NadeEvent;
  points: NadeTrajectoryPoint[];
  trajectory: Line<BufferGeometry, LineBasicMaterial> | null;
  projectile: Mesh | null;
  effect: Mesh<BufferGeometry, MeshBasicMaterial> | null;
}

export class ReplayScene {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(73.74, 1, 0.01, 10_000);
  private readonly renderer: WebGLRenderer;
  private readonly clock = new Clock();
  private readonly players = new Group();
  private readonly utilities = new Group();
  private readonly droppedEquipment = new Group();
  private readonly playerVisuals = new Map<bigint, PlayerVisual>();
  private readonly utilityVisuals: UtilityVisual[] = [];
  private readonly droppedEquipmentVisuals: DroppedEquipmentVisual[] = [];
  private droppedEquipmentCarryovers = new WeakSet<DroppedEquipment>();
  private readonly equipmentTextureLoader = new TextureLoader();
  private bombMarker: Mesh<SphereGeometry, MeshBasicMaterial> | null = null;
  private bombPrimaryLabel: Sprite | null = null;
  private bombSecondaryLabel: Sprite | null = null;
  private bombPrimaryText = '';
  private bombSecondaryText = '';
  private readonly deathTicks = new Map<bigint, number[]>();
  private readonly pressedKeys = new Set<string>();
  private readonly raycaster = new Raycaster();
  private readonly raycastHits: ReturnType<Raycaster['intersectObjects']> = [];
  private readonly lookEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly mapCenter = new Vector3();
  private readonly mapColliders: Object3D[] = [];
  private readonly colliderGrid = new Map<string, Object3D[]>();
  private readonly globalColliders: Object3D[] = [];
  private readonly raycastCandidates: Object3D[] = [];
  private readonly raycastCandidateSet = new Set<Object3D>();
  private readonly visitedRayCells = new Set<string>();
  private replay: ReplayData | null = null;
  private frames: FrameIndex = new Map();
  private tick = 0;
  private selectedPlayer: bigint | null = null;
  private selectedNade = -1;
  private cameraMode: CameraMode = 'free';
  private animationFrame = 0;
  private resizeObserver: ResizeObserver;
  private mapRoot: Group | null = null;
  private physicsRoot: Group | null = null;
  private analysisMode = true;
  private readonly analysisMaterials = new Map<Material, MeshBasicMaterial>();
  private looking = false;
  private sightCursor = 0;
  private lastSightRaycast = -Infinity;
  private showSightLines = false;
  private sightLineLength = LOS_MAX_DISTANCE_METERS;
  private sightLineOpacity = 0.5;
  private sightLineWidth = 5;
  private showDroppedWeapons = true;
  private showDroppedUtility = true;
  private showDroppedC4 = true;
  private showDroppedDefuseKit = true;
  private showPlayerUtilities = true;
  private showPlayerC4 = true;
  private showPlayerDefuseKit = true;
  private movementSpeed = 36;
  private zoomSpeed = 1;
  private movementKeys = { forward: 'KeyW', left: 'KeyA', backward: 'KeyS', right: 'KeyD' };
  private pointerStart: { x: number; y: number } | null = null;
  private onPlayerSelect: ((steamId: bigint) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new Color(0x090d12);
    this.scene.add(new AmbientLight(0xffffff, 1.8));
    const sun = new DirectionalLight(0xfff2dc, 2.2);
    sun.position.set(1000, 2200, 600);
    this.scene.add(sun, this.players, this.utilities, this.droppedEquipment);

    this.camera.position.set(30, 45, 30);
    this.camera.lookAt(0, 0, 0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.tabIndex = 0;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clearInputState);
    window.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.resize();
    this.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.clearInputState);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.disposeObject(this.players);
    this.disposeObject(this.utilities);
    this.disposeObject(this.droppedEquipment);
    if (this.physicsRoot) this.disposeObject(this.physicsRoot);
    this.analysisMaterials.forEach((material) => material.dispose());
    this.renderer.dispose();
  }

  setReplay(replay: ReplayData): void {
    this.replay = replay;
    this.frames = indexFrames(replay);
    this.clearGroup(this.players);
    this.clearGroup(this.utilities);
    this.clearGroup(this.droppedEquipment);
    this.playerVisuals.clear();
    this.utilityVisuals.length = 0;
    this.droppedEquipmentVisuals.length = 0;
    this.droppedEquipmentCarryovers = this.buildDroppedEquipmentCarryoverSet(replay);
    this.bombMarker = null;
    this.bombPrimaryLabel = null;
    this.bombSecondaryLabel = null;
    this.bombPrimaryText = '';
    this.bombSecondaryText = '';
    this.deathTicks.clear();

    for (const player of replay.players) {
      const material = new MeshBasicMaterial({ color: player.team === 3 ? CT_COLOR : T_COLOR });
      const body = new Mesh(
        new CapsuleGeometry(16 * SOURCE_UNIT_METERS, 40 * SOURCE_UNIT_METERS, 4, 8),
        material
      );
      body.name = player.name;
      body.userData.steamId = player.steamId;
      body.visible = false;

      const healthBar = new Group();
      const healthBack = new Mesh(
        new PlaneGeometry(1.24, 0.16),
        new MeshBasicMaterial({
          color: 0x111820,
          transparent: true,
          opacity: 0.45,
          depthTest: false,
          depthWrite: false
        })
      );
      const healthFill = new Mesh(
        new PlaneGeometry(1.16, 0.1),
        new MeshBasicMaterial({
          color: HEALTH_GREEN,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false
        })
      );
      healthFill.position.z = 0.002;
      healthBack.renderOrder = 10;
      healthFill.renderOrder = 11;
      healthBar.add(healthBack, healthFill);
      healthBar.visible = false;

      const nameLabel = this.createPlayerLabel();
      const weaponLabel = this.createPlayerLabel();
      const inventory = new Group();
      inventory.visible = false;

      const sightLine = new Mesh(
        new CylinderGeometry(0.5, 0.5, 1, 10, 1, false),
        new MeshBasicMaterial({ color: player.team === 3 ? CT_COLOR : T_COLOR, transparent: true, opacity: 0.5 })
      );
      sightLine.visible = false;
      sightLine.frustumCulled = false;

      this.players.add(body, healthBar, nameLabel, weaponLabel, inventory, sightLine);
      this.playerVisuals.set(player.steamId, {
        body,
        healthBar,
        healthFill,
        nameLabel,
        weaponLabel,
        inventory,
        inventoryKey: '',
        sightLine,
        eye: new Vector3(),
        direction: new Vector3(0, 0, 1),
        sightDistance: LOS_MAX_DISTANCE_METERS,
        alive: false,
        lastSightUpdate: -Infinity
      });
      this.deathTicks.set(player.steamId, this.findDeathTicks(this.frames.get(player.steamId) ?? []));
    }

    for (const nade of replay.nades) {
      const teamColor = nade.throwerTeam === 3 ? CT_COLOR : T_COLOR;
      const points3D = nade.trajectory3d.length >= 2 ? nade.trajectory3d : nade.trajectory;
      let trajectory: Line<BufferGeometry, LineBasicMaterial> | null = null;
      let projectile: Mesh | null = null;
      if (points3D.length > 0) {
        const points = points3D.map((point) => sourceToThree(point.x, point.y, point.z));
        const geometry = new BufferGeometry().setFromPoints(points);
        geometry.setDrawRange(0, 0);
        trajectory = new Line(geometry, new LineBasicMaterial({ color: teamColor }));
        trajectory.visible = false;
        projectile = this.createUtilityProjectile(nade.nadeType);
        projectile.visible = false;
        this.utilities.add(trajectory, projectile);
      }

      const effect = points3D.length === 0 ? this.createUtilityEffect(nade) : null;
      if (effect) {
        sourceToThree(nade.endX, nade.endY, nade.endZ, effect.position);
        if (effect.geometry instanceof CircleGeometry) effect.position.y += 0.035;
        effect.visible = false;
        this.utilities.add(effect);
      }
      this.utilityVisuals.push({ nade, points: points3D, trajectory, projectile, effect });
    }

    for (const item of replay.droppedEquipment) {
      const icon = this.createDroppedEquipmentIcon(item);
      this.droppedEquipment.add(icon);
      this.droppedEquipmentVisuals.push({ item, icon });
    }

    this.bombMarker = new Mesh(
      new SphereGeometry(BOMB_MARKER_RADIUS, 20, 14),
      new MeshBasicMaterial({ color: BOMB_PLANTED_COLOR })
    );
    this.bombMarker.visible = false;
    this.bombPrimaryLabel = this.createBombLabel();
    this.bombSecondaryLabel = this.createBombLabel();
    this.utilities.add(this.bombMarker, this.bombPrimaryLabel, this.bombSecondaryLabel);
    this.updateScene();
  }

  async loadMap(url: string): Promise<void> {
    let failedResource = '';
    const manager = new LoadingManager();
    manager.onError = (resourceUrl) => {
      failedResource = resourceUrl;
    };
    const loader = new GLTFLoader(manager);
    let gltf;
    try {
      gltf = await loader.loadAsync(url);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Failed to load map resource: ${failedResource || url}. ${detail}`);
    }

    gltf.scene.name = 'map';
    this.mapRoot?.removeFromParent();
    this.analysisMaterials.forEach((material) => material.dispose());
    this.analysisMaterials.clear();
    this.mapRoot = gltf.scene;
    this.scene.add(gltf.scene);
    this.applyMapMaterialMode();

    this.mapColliders.length = 0;
    gltf.scene.traverse((object) => {
      if (object instanceof Mesh && this.isRaycastableMapMesh(object.name)) this.mapColliders.push(object);
    });
    await this.loadPhysicsColliders(url);
    this.buildColliderIndex();

    const bounds = new Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new Vector3()).length();
    bounds.getCenter(this.mapCenter);
    this.camera.far = Math.max(10_000, size * 4);
    this.camera.updateProjectionMatrix();
    if (this.cameraMode === 'free') {
      this.camera.position.copy(this.mapCenter).add(new Vector3(size * 0.2, size * 0.25, size * 0.2));
      this.camera.lookAt(this.mapCenter);
    } else {
      this.updateScene();
    }
  }

  setTick(tick: number): void {
    this.tick = tick;
    this.updateScene();
  }

  setCamera(mode: CameraMode, player: bigint | null): void {
    this.cameraMode = mode;
    this.selectedPlayer = player;
    if (mode !== 'free') this.looking = false;
    this.updateScene();
  }

  setSelectedNade(index: number): void {
    this.selectedNade = index;
    this.updateUtilities();
  }

  setAnalysisMode(enabled: boolean): void {
    if (this.analysisMode === enabled) return;
    this.analysisMode = enabled;
    this.applyMapMaterialMode();
  }

  setSightSettings(visible: boolean, lengthSourceUnits: number, width: number, opacity: number): void {
    this.showSightLines = visible;
    this.sightLineLength = Math.max(0.1, lengthSourceUnits * SOURCE_UNIT_METERS);
    this.sightLineOpacity = Math.max(0, Math.min(1, opacity));
    this.sightLineWidth = Math.max(1, width);
    for (const visual of this.playerVisuals.values()) {
      visual.sightLine.material.opacity = this.sightLineOpacity;
      visual.sightDistance = this.sightLineLength;
      visual.sightLine.visible = visible && visual.alive;
      this.updateSightLineGeometry(visual);
    }
  }

  setDroppedEquipmentSettings(
    showWeapons: boolean,
    showUtility: boolean,
    showC4: boolean,
    showDefuseKit: boolean
  ): void {
    this.showDroppedWeapons = showWeapons;
    this.showDroppedUtility = showUtility;
    this.showDroppedC4 = showC4;
    this.showDroppedDefuseKit = showDefuseKit;
    this.updateDroppedEquipment();
  }

  setPlayerEquipmentSettings(showUtilities: boolean, showC4: boolean, showDefuseKit: boolean): void {
    this.showPlayerUtilities = showUtilities;
    this.showPlayerC4 = showC4;
    this.showPlayerDefuseKit = showDefuseKit;
    this.updateScene();
  }

  setCameraControls(
    movementKeys: { forward: string; left: string; backward: string; right: string },
    movementSpeed: number,
    zoomSpeed: number
  ): void {
    this.movementKeys = { ...movementKeys };
    this.movementSpeed = movementSpeed;
    this.zoomSpeed = zoomSpeed;
  }

  setPlayerSelectHandler(handler: ((steamId: bigint) => void) | null): void {
    this.onPlayerSelect = handler;
  }

  private async loadPhysicsColliders(mapUrl: string): Promise<void> {
    if (this.physicsRoot) {
      this.disposeObject(this.physicsRoot);
      this.physicsRoot = null;
    }
    const physicsUrl = mapUrl.replace(/(?:\.stream)?\.gltf(?:\?.*)?$/i, '_physics.gltf');
    if (physicsUrl === mapUrl) return;
    try {
      const physics = await new GLTFLoader().loadAsync(physicsUrl);
      this.physicsRoot = physics.scene;
      physics.scene.updateMatrixWorld(true);
      physics.scene.traverse((object) => {
        if (object instanceof Mesh && SOLID_PHYSICS_NAMES.has(object.name)) this.mapColliders.push(object);
      });
    } catch {
      // The visual map still provides bounded collision tests when a physics export is unavailable.
    }
  }

  private updateScene(): void {
    if (!this.replay) return;
    const tickRate = this.replay.header?.tickRate || 64;
    for (const [steamId, visual] of this.playerVisuals) {
      const match = frameAt(this.frames.get(steamId) ?? [], this.tick);
      if (!match) {
        this.hidePlayer(visual);
        continue;
      }
      const [a, b, alpha] = match;
      const alive = a.isAlive;
      const deathTick = alive ? -Infinity : this.latestTickAtOrBefore(this.deathTicks.get(steamId) ?? [], this.tick);
      const recentlyDead = !alive && this.tick <= deathTick + 3 * tickRate;
      if (!alive && !recentlyDead) {
        this.hidePlayer(visual);
        continue;
      }

      const x = a.x + (b.x - a.x) * alpha;
      const y = a.y + (b.y - a.y) * alpha;
      const z = a.z + (b.z - a.z) * alpha;
      const ducking = a.isDucking;
      sourceToThree(x, y, z, visual.body.position);
      const feet = visual.body.position.clone();
      visual.body.position.y += (ducking ? 36 : 48) * SOURCE_UNIT_METERS;
      visual.body.scale.y = ducking ? 0.72 : 1;
      visual.body.visible = true;

      const player = this.replay.players.find((candidate) => candidate.steamId === steamId);
      const team = a.team || (player?.team ?? 2);
      const teamColor = team === 3 ? CT_COLOR : T_COLOR;
      visual.body.material.color.setHex(alive ? teamColor : DEAD_COLOR);
      visual.body.material.transparent = !alive;
      visual.body.material.opacity = alive ? 1 : 0.5;
      visual.body.material.depthWrite = alive;

      visual.alive = alive;
      visual.healthBar.visible = alive;
      visual.nameLabel.visible = alive;
      visual.weaponLabel.visible = alive && Boolean(a.weapon);
      visual.inventory.visible = alive;
      visual.sightLine.visible = alive && this.showSightLines;
      if (!alive) continue;

      const health = Math.max(0, Math.min(100, Math.round(a.health + (b.health - a.health) * alpha)));
      const healthRatio = health / 100;
      visual.healthFill.scale.x = Math.max(0.001, healthRatio);
      visual.healthFill.position.x = -(1.16 * (1 - healthRatio)) / 2;
      visual.healthFill.material.color.setHex(health >= 70 ? HEALTH_GREEN : health >= 40 ? HEALTH_ORANGE : HEALTH_RED);
      visual.healthBar.position.copy(feet);
      visual.healthBar.position.y += (ducking ? 1.75 : 2.25);
      visual.weaponLabel.position.copy(visual.healthBar.position);
      visual.weaponLabel.position.y += PLAYER_WEAPON_LABEL_OFFSET;
      visual.nameLabel.position.copy(visual.healthBar.position);
      visual.nameLabel.position.y += PLAYER_NAME_LABEL_OFFSET;
      visual.inventory.position.copy(visual.healthBar.position);
      visual.inventory.position.y += PLAYER_INVENTORY_OFFSET;
      this.setPlayerLabel(
        visual.nameLabel,
        player?.name ?? visual.body.name,
        team === 3 ? '#62aef7' : '#e7a451',
        PLAYER_NAME_LABEL_HEIGHT,
        '700'
      );
      this.setPlayerLabel(
        visual.weaponLabel,
        a.weapon ? `${a.weapon}${a.isReloading ? ' (Reloading)' : ''}` : '',
        '#e2e8f0',
        PLAYER_WEAPON_LABEL_HEIGHT,
        '500'
      );
      this.setPlayerInventory(visual, [
        ...(this.showPlayerUtilities ? a.utilities : []),
        ...(this.showPlayerC4 && a.hasBomb ? ['C4'] : []),
        ...(this.showPlayerDefuseKit && team === 3 && a.hasDefuseKit ? ['Defuse Kit'] : [])
      ].sort((left, right) => left.localeCompare(right)));

      const useEyes = a.hasEyePosition && b.hasEyePosition;
      const eyeX = useEyes ? a.eyeX + (b.eyeX - a.eyeX) * alpha : x;
      const eyeY = useEyes ? a.eyeY + (b.eyeY - a.eyeY) * alpha : y;
      const eyeZ = useEyes ? a.eyeZ + (b.eyeZ - a.eyeZ) * alpha : z + (ducking ? 46 : 64);
      sourceToThree(eyeX, eyeY, eyeZ, visual.eye);
      sourceViewDirection(
        lerpAngleDegrees(a.yaw, b.yaw, alpha),
        lerpAngleDegrees(a.pitch, b.pitch, alpha),
        visual.direction
      );
      visual.sightLine.material.color.setHex(teamColor);
      this.updateSightLineGeometry(visual);
    }

    if (this.cameraMode === 'player' && this.selectedPlayer !== null) {
      const match = frameAt(this.frames.get(this.selectedPlayer) ?? [], this.tick);
      if (match) this.updatePlayerCamera(...match);
    }
    this.updateUtilities();
    this.updateDroppedEquipment();
    this.updateBombMarker();
  }

  private updateBombMarker(): void {
    if (!this.replay || !this.bombMarker || !this.bombPrimaryLabel || !this.bombSecondaryLabel) return;
    let roundStart = -Infinity;
    let nextRoundStart = Infinity;
    for (let index = 0; index < this.replay.rounds.length; index++) {
      const round = this.replay.rounds[index];
      if (round.startTick > this.tick) {
        nextRoundStart = round.startTick;
        break;
      }
      roundStart = round.startTick;
      nextRoundStart = this.replay.rounds[index + 1]?.startTick ?? Infinity;
    }
    if (!Number.isFinite(roundStart)) {
      this.hideBombMarker();
      return;
    }

    const roundBombs = this.replay.bombs.filter((event) =>
      event.tick >= roundStart && event.tick < nextRoundStart && event.tick <= this.tick
    );
    const planted = [...roundBombs].reverse().find((event) => event.eventType === 'planted');
    if (!planted) {
      this.hideBombMarker();
      return;
    }

    const terminal = [...roundBombs].reverse().find((event) =>
      event.tick >= planted.tick && (event.eventType === 'defused' || event.eventType === 'exploded')
    );
    this.bombMarker.material.color.setHex(
      terminal?.eventType === 'defused'
        ? BOMB_DEFUSED_COLOR
        : terminal?.eventType === 'exploded'
          ? BOMB_EXPLODED_COLOR
          : BOMB_PLANTED_COLOR
    );
    this.setBombMarkerPosition(planted);
    this.bombMarker.visible = true;

    let primaryText: string;
    let primaryColor: string;
    let secondaryText = '';
    if (terminal?.eventType === 'defused') {
      primaryText = 'Bomb defused';
      primaryColor = '#62aef7';
    } else if (terminal?.eventType === 'exploded') {
      primaryText = 'Bomb exploded';
      primaryColor = '#ef3340';
    } else {
      const tickRate = this.replay.header?.tickRate || 64;
      const bombTimeSeconds = this.replay.header?.bombTimeSeconds || DEFAULT_BOMB_TIME_SECONDS;
      const explosionTick = planted.tick + Math.round(bombTimeSeconds * tickRate);
      const secondsLeft = Math.max(0, Math.ceil((explosionTick - this.tick) / tickRate));
      primaryText = `${secondsLeft}s`;
      primaryColor = '#f97316';

      const defuseStart = [...roundBombs].reverse().find((event) =>
        event.eventType === 'defuse_start' && event.tick >= planted.tick
      );
      if (defuseStart) {
        const interrupted = roundBombs.some((event) =>
          event.tick >= defuseStart.tick &&
          (event.eventType === 'defuse_aborted' || event.eventType === 'defused' || event.eventType === 'exploded')
        );
        const playerMatch = defuseStart.playerSteamId > 0n
          ? frameAt(this.frames.get(defuseStart.playerSteamId) ?? [], this.tick)
          : null;
        const defuserAlive = !playerMatch || playerMatch[0].isAlive;
        if (!interrupted && defuserAlive) {
          const defuseSeconds = defuseStart.hasKit ? DEFUSE_SECONDS_WITH_KIT : DEFUSE_SECONDS_WITHOUT_KIT;
          const defuseEndTick = defuseStart.tick + Math.round(defuseSeconds * tickRate);
          if (this.tick < defuseEndTick) {
            const defuseSecondsLeft = Math.max(0, Math.ceil((defuseEndTick - this.tick) / tickRate));
            secondaryText = `Defusing Bomb ${defuseSecondsLeft}s`;
          }
        }
      }
    }

    this.setBombLabel(this.bombPrimaryLabel, primaryText, primaryColor, 'primary');
    this.setBombLabel(this.bombSecondaryLabel, secondaryText, '#62aef7', 'secondary');
    this.positionBombLabels();
  }

  private hideBombMarker(): void {
    if (this.bombMarker) this.bombMarker.visible = false;
    if (this.bombPrimaryLabel) this.bombPrimaryLabel.visible = false;
    if (this.bombSecondaryLabel) this.bombSecondaryLabel.visible = false;
  }

  private setBombMarkerPosition(planted: BombEvent): void {
    if (!this.bombMarker) return;
    let x = planted.x;
    let y = planted.y;
    let z = planted.z;
    if (x === 0 && y === 0 && z === 0 && planted.playerSteamId > 0n) {
      const match = frameAt(this.frames.get(planted.playerSteamId) ?? [], planted.tick);
      if (match) {
        x = match[0].x;
        y = match[0].y;
        z = match[0].z;
      }
    }
    sourceToThree(x, y, z, this.bombMarker.position);
    this.bombMarker.position.y += BOMB_MARKER_RADIUS;
  }

  private createPlayerLabel(): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 96;
    const material = new SpriteMaterial({
      map: new CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new Sprite(material);
    sprite.userData.canvas = canvas;
    sprite.renderOrder = 100;
    sprite.visible = false;
    return sprite;
  }

  private setPlayerLabel(
    sprite: Sprite,
    text: string,
    color: string,
    height: number,
    fontWeight: string
  ): void {
    if (
      sprite.userData.text === text &&
      sprite.userData.color === color &&
      sprite.userData.height === height &&
      sprite.userData.fontWeight === fontWeight
    ) {
      sprite.visible = text.length > 0;
      return;
    }
    sprite.userData.text = text;
    sprite.userData.color = color;
    sprite.userData.height = height;
    sprite.userData.fontWeight = fontWeight;
    sprite.visible = text.length > 0;
    if (!text) return;

    const canvas = sprite.userData.canvas as HTMLCanvasElement;
    const font = `${fontWeight} 56px system-ui, sans-serif`;
    const measurement = canvas.getContext('2d');
    if (!measurement) return;
    measurement.font = font;
    canvas.width = Math.max(2, Math.ceil(measurement.measureText(text).width + 32));
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 10;
    context.strokeStyle = 'rgba(4, 8, 14, 0.95)';
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const previousTexture = sprite.material.map;
    sprite.material.map = new CanvasTexture(canvas);
    sprite.material.needsUpdate = true;
    previousTexture?.dispose();
    sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  }

  private createBombLabel(): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 160;
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new Sprite(material);
    sprite.userData.canvas = canvas;
    sprite.renderOrder = 100;
    sprite.visible = false;
    return sprite;
  }

  private setBombLabel(sprite: Sprite, text: string, color: string, slot: 'primary' | 'secondary'): void {
    const previousText = slot === 'primary' ? this.bombPrimaryText : this.bombSecondaryText;
    if (previousText === text && sprite.userData.color === color) {
      sprite.visible = text.length > 0;
      return;
    }
    if (slot === 'primary') this.bombPrimaryText = text;
    else this.bombSecondaryText = text;
    sprite.userData.color = color;
    sprite.visible = text.length > 0;
    if (!text) return;

    const canvas = sprite.userData.canvas as HTMLCanvasElement;
    const font = '700 96px system-ui, sans-serif';
    const measurement = canvas.getContext('2d');
    if (!measurement) return;
    measurement.font = font;
    canvas.width = Math.max(2, Math.ceil(measurement.measureText(text).width + 48));
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 14;
    context.strokeStyle = 'rgba(4, 8, 14, 0.95)';
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const previousTexture = sprite.material.map;
    sprite.material.map = new CanvasTexture(canvas);
    sprite.material.needsUpdate = true;
    previousTexture?.dispose();
    sprite.scale.set(BOMB_LABEL_HEIGHT * (canvas.width / canvas.height), BOMB_LABEL_HEIGHT, 1);
  }

  private positionBombLabels(): void {
    if (!this.bombMarker || !this.bombPrimaryLabel || !this.bombSecondaryLabel) return;
    this.bombPrimaryLabel.position.copy(this.bombMarker.position);
    this.bombPrimaryLabel.position.y += BOMB_PRIMARY_LABEL_OFFSET;
    this.bombSecondaryLabel.position.copy(this.bombMarker.position);
    this.bombSecondaryLabel.position.y += BOMB_SECONDARY_LABEL_OFFSET;
  }

  private updatePlayerCamera(a: PlayerFrame, b: PlayerFrame, alpha: number): void {
    const useEyes = a.hasEyePosition && b.hasEyePosition;
    const ax = useEyes ? a.eyeX : a.x;
    const ay = useEyes ? a.eyeY : a.y;
    const az = useEyes ? a.eyeZ : a.z + (a.isDucking ? 46 : 64);
    const bx = useEyes ? b.eyeX : b.x;
    const by = useEyes ? b.eyeY : b.y;
    const bz = useEyes ? b.eyeZ : b.z + (b.isDucking ? 46 : 64);
    sourceToThree(ax + (bx - ax) * alpha, ay + (by - ay) * alpha, az + (bz - az) * alpha, this.camera.position);
    const direction = sourceViewDirection(
      lerpAngleDegrees(a.yaw, b.yaw, alpha),
      lerpAngleDegrees(a.pitch, b.pitch, alpha)
    );
    this.camera.lookAt(this.camera.position.clone().add(direction));
  }

  private updateUtilities(): void {
    if (!this.replay) return;
    const tickRate = this.replay.header?.tickRate || 64;
    this.utilityVisuals.forEach((visual, index) => {
      const { nade, points, trajectory, projectile, effect } = visual;
      if (trajectory && projectile && points.length > 0) {
        const firstTick = points[0].tick;
        const flightEnd = Math.max(firstTick, nade.detonationTick);
        const selected = index === this.selectedNade;
        const active = this.tick >= firstTick && this.tick <= flightEnd;
        trajectory.visible = selected || active;
        if (trajectory.visible) {
          const count = selected ? points.length : this.trajectoryPointCountAt(points, this.tick);
          trajectory.geometry.setDrawRange(0, Math.max(0, count));
        }
        projectile.visible = active;
        if (active) this.utilityPositionAt(points, this.tick, projectile.position);
      }

      if (effect) {
        const endTick = this.utilityEffectEndTick(nade, tickRate);
        effect.visible = this.tick >= nade.detonationTick && this.tick <= endTick;
      }
    });
  }

  private utilityEffectEndTick(nade: NadeEvent, tickRate: number): number {
    switch (nade.nadeType) {
      case 'smoke': return nade.detonationTick + 18 * tickRate;
      case 'molotov':
      case 'incendiary': return nade.detonationTick + 7 * tickRate;
      case 'hegrenade':
      case 'flashbang': return nade.detonationTick + 2 * tickRate;
      default: return Math.max(nade.detonationTick, nade.fadeTick);
    }
  }

  private createUtilityProjectile(nadeType: string): Mesh {
    const color = UTILITY_COLORS[nadeType] ?? 0xffffff;
    const material = new MeshBasicMaterial({ color });
    if (nadeType === 'hegrenade' || nadeType === 'smoke') {
      return new Mesh(new SphereGeometry(4 * SOURCE_UNIT_METERS, 12, 8), material);
    }
    const length = nadeType === 'molotov' || nadeType === 'incendiary' ? 10 : 7;
    return new Mesh(
      new BoxGeometry(3 * SOURCE_UNIT_METERS, length * SOURCE_UNIT_METERS, 3 * SOURCE_UNIT_METERS),
      material
    );
  }

  private createUtilityEffect(nade: NadeEvent): Mesh<BufferGeometry, MeshBasicMaterial> | null {
    if (!(nade.nadeType in UTILITY_COLORS)) return null;
    const isSmoke = nade.nadeType === 'smoke';
    const radiusSourceUnits = nade.nadeType === 'decoy'
      ? 5
      : Math.max(1, nade.effectRadius || this.defaultUtilityRadius(nade.nadeType));
    const radiusScale = nade.nadeType === 'smoke'
      ? 0.9
      : nade.nadeType === 'hegrenade' || nade.nadeType === 'flashbang'
        ? 0.5
        : 1;
    const material = new MeshBasicMaterial({
      color: UTILITY_COLORS[nade.nadeType],
      transparent: !isSmoke,
      opacity: isSmoke ? 1 : 0.3,
      depthWrite: isSmoke,
      side: DoubleSide
    });
    const radius = radiusSourceUnits * radiusScale * SOURCE_UNIT_METERS;
    const usesSphere = nade.nadeType === 'smoke' || nade.nadeType === 'flashbang' || nade.nadeType === 'hegrenade';
    const effect = new Mesh(
      usesSphere ? new SphereGeometry(radius, 32, 20) : new CircleGeometry(radius, 48),
      material
    );
    if (!usesSphere) effect.rotation.x = -Math.PI / 2;
    effect.renderOrder = 3;
    return effect;
  }

  private defaultUtilityRadius(nadeType: string): number {
    if (nadeType === 'smoke') return 200;
    if (nadeType === 'hegrenade') return 250;
    if (nadeType === 'flashbang') return 400;
    if (nadeType === 'molotov' || nadeType === 'incendiary') return 150;
    return 5;
  }

  private createDroppedEquipmentIcon(item: DroppedEquipment): Sprite {
    const iconSize = item.category === 'weapon'
      ? DROPPED_EQUIPMENT_ICON_SIZE * 1.1
      : DROPPED_EQUIPMENT_ICON_SIZE;
    const icon = this.createEquipmentIcon(item.equipmentName, iconSize, 90);
    sourceToThree(item.x, item.y, item.z, icon.position);
    icon.position.y += DROPPED_EQUIPMENT_HEIGHT_OFFSET;
    return icon;
  }

  private createEquipmentIcon(equipmentName: string, iconSize: number, renderOrder: number): Sprite {
    let icon: Sprite;
    const texture = this.equipmentTextureLoader.load(getWeaponIconPath(equipmentName), (loadedTexture) => {
      const image = loadedTexture.image as HTMLImageElement | undefined;
      const width = image?.naturalWidth || image?.width || 1;
      const height = image?.naturalHeight || image?.height || 1;
      const scale = iconSize / Math.max(width, height);
      icon.scale.set(width * scale, height * scale, 1);
    });
    icon = new Sprite(new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }));
    icon.scale.set(iconSize, iconSize, 1);
    icon.renderOrder = renderOrder;
    icon.visible = false;
    return icon;
  }

  private setPlayerInventory(visual: PlayerVisual, equipmentNames: string[]): void {
    const inventoryKey = equipmentNames.join('\u0000');
    if (visual.inventoryKey !== inventoryKey) {
      visual.inventoryKey = inventoryKey;
      this.clearGroup(visual.inventory);
      const totalWidth = equipmentNames.length * PLAYER_INVENTORY_ICON_SIZE +
        Math.max(0, equipmentNames.length - 1) * PLAYER_INVENTORY_ICON_GAP;
      const firstX = -totalWidth / 2 + PLAYER_INVENTORY_ICON_SIZE / 2;
      equipmentNames.forEach((equipmentName, index) => {
        const icon = this.createEquipmentIcon(equipmentName, PLAYER_INVENTORY_ICON_SIZE, 100);
        icon.position.x = firstX + index * (PLAYER_INVENTORY_ICON_SIZE + PLAYER_INVENTORY_ICON_GAP);
        icon.visible = true;
        visual.inventory.add(icon);
      });
    }
    visual.inventory.visible = equipmentNames.length > 0;
  }

  private updateDroppedEquipment(): void {
    if (!this.replay) return;
    for (const visual of this.droppedEquipmentVisuals) {
      visual.icon.visible = this.isDroppedEquipmentVisible(visual.item);
    }
  }

  private isDroppedEquipmentVisible(item: DroppedEquipment): boolean {
    if (!this.replay || this.droppedEquipmentCarryovers.has(item)) return false;
    if (item.startTick > this.tick || item.endTick < this.tick) return false;
    const round = getRoundForTick(this.replay, this.tick);
    if (
      round &&
      (item.startTick < round.startTick || item.startTick > getRoundDisplayEndTick(this.replay, round))
    ) {
      return false;
    }
    if (item.category === 'weapon') return this.showDroppedWeapons;
    if (item.category === 'utility') return this.showDroppedUtility;
    if (item.category === 'c4') return this.showDroppedC4;
    if (item.category === 'defuse_kit') return this.showDroppedDefuseKit;
    return false;
  }

  private buildDroppedEquipmentCarryoverSet(replay: ReplayData): WeakSet<DroppedEquipment> {
    const carryovers = new WeakSet<DroppedEquipment>();
    const priorSegmentsByEquipment = new Map<string, DroppedEquipment[]>();
    const sortedItems = [...replay.droppedEquipment].sort((a, b) => a.startTick - b.startTick);
    for (const item of sortedItems) {
      const itemRound = replay.rounds.find(round =>
        item.startTick >= round.startTick &&
        item.startTick <= getRoundDisplayEndTick(replay, round)
      );
      const roundStart = itemRound?.startTick;
      const key = `${item.category}:${item.equipmentName}`;
      const priorSegments = priorSegmentsByEquipment.get(key) ?? [];
      let continuousPreviousSegment: DroppedEquipment | undefined;
      for (let index = priorSegments.length - 1; index >= 0; index--) {
        const previous = priorSegments[index];
        const dx = previous.x - item.x;
        const dy = previous.y - item.y;
        const dz = previous.z - item.z;
        if (
          previous.endTick >= item.startTick - 1 &&
          dx * dx + dy * dy + dz * dz <= ROUND_CARRYOVER_POSITION_DISTANCE_SQUARED
        ) {
          continuousPreviousSegment = previous;
          break;
        }
      }
      const isRoundBoundaryCarryover = roundStart !== undefined &&
        item.startTick <= roundStart + ROUND_CARRYOVER_DETECTION_TICKS &&
        priorSegments.some(previous => {
          const dx = previous.x - item.x;
          const dy = previous.y - item.y;
          const dz = previous.z - item.z;
          return previous.startTick < roundStart &&
            previous.endTick >= roundStart - 1 &&
            dx * dx + dy * dy + dz * dz <= ROUND_CARRYOVER_POSITION_DISTANCE_SQUARED;
        });
      const continuesCarryoverMovement = continuousPreviousSegment !== undefined && carryovers.has(continuousPreviousSegment);
      if (isRoundBoundaryCarryover || continuesCarryoverMovement) carryovers.add(item);
      priorSegments.push(item);
      priorSegmentsByEquipment.set(key, priorSegments);
    }
    return carryovers;
  }

  private utilityPositionAt(points: NadeTrajectoryPoint[], tick: number, target: Vector3): void {
    if (points.length === 0) return;
    if (tick <= points[0].tick) {
      sourceToThree(points[0].x, points[0].y, points[0].z, target);
      return;
    }
    let low = 0;
    let high = points.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (points[mid].tick <= tick) low = mid + 1;
      else high = mid - 1;
    }
    const a = points[Math.max(0, high)];
    const b = points[Math.min(points.length - 1, high + 1)];
    const alpha = b.tick > a.tick ? (tick - a.tick) / (b.tick - a.tick) : 0;
    sourceToThree(
      a.x + (b.x - a.x) * alpha,
      a.y + (b.y - a.y) * alpha,
      a.z + (b.z - a.z) * alpha,
      target
    );
  }

  private trajectoryPointCountAt(points: NadeTrajectoryPoint[], tick: number): number {
    let low = 0;
    let high = points.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (points[mid].tick <= tick) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private updateSightLines(now: number): void {
    const active = [...this.playerVisuals.values()].filter((visual) => visual.alive && visual.sightLine.visible);
    if (active.length === 0 || now - this.lastSightRaycast < LOS_GLOBAL_INTERVAL_MS) return;
    for (let attempts = 0; attempts < active.length; attempts++) {
      const visual = active[this.sightCursor % active.length];
      this.sightCursor = (this.sightCursor + 1) % active.length;
      if (now - visual.lastSightUpdate < LOS_RAYCAST_INTERVAL_MS) continue;
      visual.lastSightUpdate = now;
      this.lastSightRaycast = now;
      this.raycaster.set(visual.eye, visual.direction);
      this.raycaster.near = 0.02;
      this.raycaster.far = this.sightLineLength;
      this.raycastHits.length = 0;
      this.raycaster.intersectObjects(this.raycastCandidatesFor(visual.eye, visual.direction), false, this.raycastHits);
      visual.sightDistance = this.raycastHits.length > 0
        ? this.raycastHits[0].distance
        : this.sightLineLength;
      this.updateSightLineGeometry(visual);
      break;
    }
  }

  private updateSightLineGeometry(visual: PlayerVisual): void {
    const end = visual.eye.clone().addScaledVector(visual.direction, visual.sightDistance);
    const delta = end.clone().sub(visual.eye);
    const distance = Math.max(0.001, delta.length());
    visual.sightLine.position.copy(visual.eye).add(end).multiplyScalar(0.5);
    visual.sightLine.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    const diameter = this.sightLineWidth * SOURCE_UNIT_METERS;
    visual.sightLine.scale.set(diameter, distance, diameter);
  }

  private buildColliderIndex(): void {
    this.colliderGrid.clear();
    this.globalColliders.length = 0;
    this.mapRoot?.updateMatrixWorld(true);
    this.physicsRoot?.updateMatrixWorld(true);
    const bounds = new Box3();
    for (const object of this.mapColliders) {
      if (!(object instanceof Mesh)) continue;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) continue;
      bounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
      const minX = Math.floor(bounds.min.x / COLLIDER_CELL_SIZE_METERS);
      const minY = Math.floor(bounds.min.y / COLLIDER_CELL_SIZE_METERS);
      const minZ = Math.floor(bounds.min.z / COLLIDER_CELL_SIZE_METERS);
      const maxX = Math.floor(bounds.max.x / COLLIDER_CELL_SIZE_METERS);
      const maxY = Math.floor(bounds.max.y / COLLIDER_CELL_SIZE_METERS);
      const maxZ = Math.floor(bounds.max.z / COLLIDER_CELL_SIZE_METERS);
      const cellCount = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
      if (!Number.isFinite(cellCount) || cellCount > MAX_CELLS_PER_COLLIDER) {
        this.globalColliders.push(object);
        continue;
      }
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const key = this.colliderCellKey(x, y, z);
            const cell = this.colliderGrid.get(key);
            if (cell) cell.push(object);
            else this.colliderGrid.set(key, [object]);
          }
        }
      }
    }
  }

  private isRaycastableMapMesh(name: string): boolean {
    // VRF aggregate meshes combine repeated decorative pieces spread across the entire map.
    // Their enormous sparse bounds make them unsuitable collision proxies. Base world chunks
    // plus the dedicated solid-entity physics export retain walls, floors, doors, and props.
    return !name.includes('blocklight') && !name.includes('_agg_merge_') && !name.includes('overlay');
  }

  private raycastCandidatesFor(origin: Vector3, direction: Vector3): Object3D[] {
    this.raycastCandidates.length = 0;
    this.raycastCandidateSet.clear();
    this.visitedRayCells.clear();
    const add = (object: Object3D) => {
      if (this.raycastCandidateSet.has(object)) return;
      this.raycastCandidateSet.add(object);
      this.raycastCandidates.push(object);
    };
    this.globalColliders.forEach(add);
    const step = COLLIDER_CELL_SIZE_METERS / 2;
    for (let distance = 0; distance <= LOS_MAX_DISTANCE_METERS; distance += step) {
      const x = Math.floor((origin.x + direction.x * distance) / COLLIDER_CELL_SIZE_METERS);
      const y = Math.floor((origin.y + direction.y * distance) / COLLIDER_CELL_SIZE_METERS);
      const z = Math.floor((origin.z + direction.z * distance) / COLLIDER_CELL_SIZE_METERS);
      const key = this.colliderCellKey(x, y, z);
      if (this.visitedRayCells.has(key)) continue;
      this.visitedRayCells.add(key);
      this.colliderGrid.get(key)?.forEach(add);
    }
    return this.raycastCandidates;
  }

  private colliderCellKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private applyMapMaterialMode(): void {
    this.mapRoot?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const original = object.userData.sourceMaterial ?? object.material;
      object.userData.sourceMaterial = original;
      if (!this.analysisMode) {
        object.material = original;
        return;
      }
      const materials = Array.isArray(original) ? original : [original];
      const converted = materials.map((material) => this.analysisMaterial(material));
      object.material = Array.isArray(original) ? converted : converted[0];
    });
  }

  private analysisMaterial(material: Material): MeshBasicMaterial {
    const cached = this.analysisMaterials.get(material);
    if (cached) return cached;
    const source = material as MeshStandardMaterial;
    const analysis = new MeshBasicMaterial({
      map: source.map ?? null,
      color: source.color?.clone() ?? new Color(0xffffff),
      alphaMap: source.alphaMap ?? null,
      alphaTest: source.alphaTest,
      opacity: source.opacity,
      transparent: source.transparent,
      side: source.side,
      vertexColors: source.vertexColors,
      depthWrite: source.depthWrite
    });
    analysis.name = `${material.name}-analysis`;
    this.analysisMaterials.set(material, analysis);
    return analysis;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, button, textarea')) return;
    this.pressedKeys.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.cameraMode !== 'free' || event.button !== 0) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.looking = true;
    this.lookEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.focus();
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.looking || this.cameraMode !== 'free') return;
    this.lookEuler.y -= event.movementX * MOUSE_LOOK_SENSITIVITY;
    this.lookEuler.x -= event.movementY * MOUSE_LOOK_SENSITIVITY;
    this.lookEuler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.lookEuler.x));
    this.camera.quaternion.setFromEuler(this.lookEuler);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const pointerStart = this.pointerStart;
    this.pointerStart = null;
    this.looking = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 5) {
      const rect = this.canvas.getBoundingClientRect();
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(pointer, this.camera);
      const hit = this.raycaster.intersectObjects([...this.playerVisuals.values()].map((visual) => visual.body), false)[0];
      const steamId = hit?.object.userData.steamId;
      if (typeof steamId === 'bigint') this.onPlayerSelect?.(steamId);
    }
  };

  private handleWheel = (event: WheelEvent): void => {
    if (this.cameraMode !== 'free') return;
    event.preventDefault();
    const direction = this.camera.getWorldDirection(new Vector3());
    const referenceDistance = Math.max(2, this.camera.position.distanceTo(this.mapCenter));
    const distance = Math.max(1.5, referenceDistance * 0.1) * this.zoomSpeed;
    this.camera.position.addScaledVector(direction, event.deltaY < 0 ? distance : -distance);
  };

  private clearInputState = (): void => {
    this.pressedKeys.clear();
    this.looking = false;
  };

  private moveFreeCamera(deltaSeconds: number): void {
    if (this.cameraMode !== 'free' || this.pressedKeys.size === 0) return;
    const speed = this.movementSpeed * (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight') ? 3.75 : 1) * deltaSeconds;
    const forward = this.camera.getWorldDirection(new Vector3());
    if (forward.lengthSq() === 0) return;
    forward.normalize();
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const movement = new Vector3();
    if (this.pressedKeys.has(this.movementKeys.forward)) movement.add(forward);
    if (this.pressedKeys.has(this.movementKeys.backward)) movement.sub(forward);
    if (this.pressedKeys.has(this.movementKeys.right)) movement.add(right);
    if (this.pressedKeys.has(this.movementKeys.left)) movement.sub(right);
    if (movement.lengthSq() === 0) return;
    movement.normalize().multiplyScalar(speed);
    this.camera.position.add(movement);
  }

  private render = (now = performance.now()): void => {
    this.moveFreeCamera(Math.min(0.1, this.clock.getDelta()));
    this.updateSightLines(now);
    for (const visual of this.playerVisuals.values()) {
      if (visual.healthBar.visible) visual.healthBar.quaternion.copy(this.camera.quaternion);
      if (visual.inventory.visible) visual.inventory.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.render);
  };

  private findDeathTicks(frames: PlayerFrame[]): number[] {
    const ticks: number[] = [];
    for (let index = 1; index < frames.length; index++) {
      if (frames[index - 1].isAlive && !frames[index].isAlive) ticks.push(frames[index].tick);
    }
    return ticks;
  }

  private latestTickAtOrBefore(ticks: number[], tick: number): number {
    let low = 0;
    let high = ticks.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (ticks[mid] <= tick) low = mid + 1;
      else high = mid - 1;
    }
    return high >= 0 ? ticks[high] : -Infinity;
  }

  private hidePlayer(visual: PlayerVisual): void {
    visual.body.visible = false;
    visual.healthBar.visible = false;
    visual.nameLabel.visible = false;
    visual.weaponLabel.visible = false;
    visual.inventory.visible = false;
    visual.sightLine.visible = false;
    visual.alive = false;
  }

  private clearGroup(group: Group): void {
    for (const child of [...group.children]) {
      child.removeFromParent();
      this.disposeObject(child);
    }
  }

  private disposeObject(root: Object3D): void {
    root.traverse((object) => {
      if (object instanceof Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
        return;
      }
      if (!(object instanceof Mesh || object instanceof Line)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
