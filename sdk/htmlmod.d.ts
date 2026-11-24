// Typings for the Html Sandbox mod API (version 1). Use with `// @ts-check` + `/** @param {import('./htmlmod').ModAPI} api */`.
import type * as THREE_NS from 'three';

export interface Manifest { id: string; name: string; version: string; author: string; description: string; api: number; main: string | null; html: string | null; css: string[]; }
export interface NextbotDef { id: string; name: string; texture: string; height?: number; speed?: number; turnRate?: number; accel?: number; decel?: number; order?: number; }
export interface PropDef { id: string; name: string; size: [number, number, number]; color?: string; order?: number; }
export interface SpawnItem { id: string; name: string; image?: string; swatch?: string; }
export interface SpawnTabDef { id: string; label: string; order?: number; items(): SpawnItem[]; spawn(itemId: string, point: THREE_NS.Vector3, game: any): void; }
export interface MapDef { id: string; name: string; url: string; eyeHeight: number; spawn: { x: number; y: number; z: number; yaw: number }; }
export interface MenuButtonDef { id?: string; label: string; where?: 'main' | 'pause' | 'both'; order?: number; onClick(): void; }
export type SettingDef =
  | { id: string; label: string; type: 'toggle'; default: boolean; category?: string }
  | { id: string; label: string; type: 'slider'; default: number; min: number; max: number; step?: number; category?: string }
  | { id: string; label: string; type: 'select'; default: string; options: { value: string; label: string }[]; category?: string };

export declare class Entity {
  type: string; object3d: THREE_NS.Group; world: any; pickMesh: THREE_NS.Mesh | null; displayName: string;
  constructor(type: string);
  onAdded(): void; onRemoved(): void; update(dt: number, ctx: { player: any; camera: THREE_NS.Camera }): void;
}

export interface GameEvents {
  ready: any; start: void; pause: void; resume: void; quit: void;
  update: number; caught: any; 'entity:add': Entity; 'entity:remove': Entity;
  keydown: { code: string; repeat: boolean }; keyup: { code: string; repeat: boolean };
}

export interface ModAPI {
  readonly id: string; readonly manifest: Manifest; readonly apiVersion: number;
  readonly THREE: typeof THREE_NS; readonly CONFIG: any;
  log(...args: unknown[]): void;
  on<K extends keyof GameEvents>(name: K, fn: (payload: GameEvents[K]) => void): () => void;
  bus: { on(name: string, fn: (payload: any) => void): () => void; emit(name: string, payload?: any): void };
  onUnload(fn: () => void): void;
  import(spec: string): Promise<any>;
  classes: { Entity: typeof Entity; Nextbot: any; Prop: any };
  assets: {
    has(path: string): boolean; list(prefix?: string): string[]; url(path: string): Promise<string>;
    text(path: string): Promise<string>; json(path: string): Promise<any>; bytes(path: string): Promise<Uint8Array>;
    texture(path: string, opts?: { flipY?: boolean; repeat?: boolean }): Promise<THREE_NS.Texture>;
  };
  nextbots: { register(def: NextbotDef): Promise<NextbotDef> };
  props: { register(def: PropDef): PropDef };
  spawnTabs: { register(def: SpawnTabDef): SpawnTabDef };
  maps: { register(def: MapDef): MapDef };
  menu: { addButton(def: MenuButtonDef): MenuButtonDef };
  settings: { define(def: SettingDef): void; get(id: string): any; set(id: string, value: any): void; onChange(fn: (e: { id: string; value: any }) => void): () => void };
  storage: { get<T = any>(key: string, fallback?: T): T; set(key: string, value: any): void; remove(key: string): void };
  config: { get(path: string): any; set(path: string, value: any): void };
  ui: {
    el(tag: string, props?: Record<string, any>, ...children: any[]): HTMLElement;
    Button(o: { label: string; onClick?: () => void; size?: 'md' | 'sm'; active?: boolean }): HTMLElement;
    Panel(o: { title?: string; body: any; footer?: any; className?: string }): HTMLElement;
    Tabs(o: { tabs: { id: string; label: string; render(): Node }[]; active?: string }): { root: HTMLElement; select(id: string): void; refresh(): void };
    Card(o: { name: string; image?: string; swatch?: string; onClick?: () => void }): HTMLElement;
    SettingControl(def: SettingDef, value: any, onChange: (v: any) => void): HTMLElement;
    toast(message: string): void;
    mount<T extends Node>(node: T): T;
    mountHud<T extends Node>(node: T): T;
  };
  cursor: { free(): () => void };
  entities: { add<T extends Entity>(e: T): T; remove(e: Entity): void };
  spawn: { nextbot(id: string, point?: THREE_NS.Vector3): void; prop(id: string, point?: THREE_NS.Vector3): void; aimPoint(): THREE_NS.Vector3 };
  readonly game: any; readonly world: any; readonly scene: THREE_NS.Scene | null; readonly player: any;
  readonly camera: THREE_NS.PerspectiveCamera | null; readonly renderer: any; readonly input: any; readonly hud: any;
  readonly ready: Promise<any>;
}

declare const _default: (api: ModAPI) => void | Promise<void>;
export type ModMain = typeof _default;
