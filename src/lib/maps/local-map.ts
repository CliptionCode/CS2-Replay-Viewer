import { invoke } from '@tauri-apps/api/core';

export interface LocalMapStatus {
  mapName: string;
  vpkPath?: string;
  cachePath: string;
  scenePath?: string;
  ready: boolean;
  extractorAvailable: boolean;
  materialWarning?: string;
}

export function validateCs2Folder(path: string): Promise<string> {
  return invoke<string>('validate_cs2_folder', { path });
}

export function getMapStatus(mapName: string, gamePath: string): Promise<LocalMapStatus> {
  return invoke<LocalMapStatus>('map_status', { mapName, gamePath });
}

export function prepareMap(mapName: string, gamePath: string): Promise<LocalMapStatus> {
  return invoke<LocalMapStatus>('prepare_map', { mapName, gamePath });
}

export function mapSceneUrl(status: LocalMapStatus, gamePath: string): Promise<string> {
  return invoke<string>('map_scene_url', { mapName: status.mapName, gamePath });
}
