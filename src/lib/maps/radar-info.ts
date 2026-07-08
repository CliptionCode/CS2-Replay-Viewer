export interface RadarVerticalSection {
    altitudeMin: number;
    altitudeMax: number;
    imagePath: string;
}

export interface RadarInfo {
    name: string;
    material: string;
    posX: number;
    posY: number;
    scale: number;
    rotate: number;
    zoom: number;
    width: number;
    height: number;
    imagePath: string;
    rawInfoPath: string;
    verticalSections?: Record<string, RadarVerticalSection>;
}

const RADAR_SIZE = 1024;
export const DEFAULT_RADAR_MAP = 'de_dust2';

export const RADAR_INFO_BY_MAP = {
    de_ancient: {
        name: 'de_ancient',
        material: 'overviews/de_ancient',
        posX: -2953,
        posY: 2164,
        scale: 5,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_ancient.png',
        rawInfoPath: '/maps/radar_info/de_ancient.txt',
    },
    de_anubis: {
        name: 'de_anubis',
        material: 'overviews/de_anubis',
        posX: -2796,
        posY: 3328,
        scale: 5.22,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_anubis.png',
        rawInfoPath: '/maps/radar_info/de_anubis.txt',
    },
    de_cache: {
        name: 'de_cache',
        material: 'overviews/de_cache_radar',
        posX: -2000,
        posY: 3250,
        scale: 5.5,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_cache.png',
        rawInfoPath: '/maps/radar_info/de_cache.txt',
    },
    de_dust2: {
        name: 'de_dust2',
        material: 'overviews/de_dust2_v2',
        posX: -2476,
        posY: 3239,
        scale: 4.4,
        rotate: 1,
        zoom: 1.1,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_dust2.png',
        rawInfoPath: '/maps/radar_info/de_dust2.txt',
    },
    de_inferno: {
        name: 'de_inferno',
        material: 'overviews/de_inferno',
        posX: -2087,
        posY: 3870,
        scale: 4.9,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_inferno.png',
        rawInfoPath: '/maps/radar_info/de_inferno.txt',
    },
    de_mirage: {
        name: 'de_mirage',
        material: 'overviews/de_mirage',
        posX: -3230,
        posY: 1713,
        scale: 5,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_mirage.png',
        rawInfoPath: '/maps/radar_info/de_mirage.txt',
    },
    de_nuke: {
        name: 'de_nuke',
        material: 'overviews/de_nuke',
        posX: -3453,
        posY: 2887,
        scale: 7,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_nuke.png',
        rawInfoPath: '/maps/radar_info/de_nuke.txt',
        verticalSections: {
            default: {
                altitudeMin: -495,
                altitudeMax: 10000,
                imagePath: '/maps/de_nuke.png',
            },
            lower: {
                altitudeMin: -10000,
                altitudeMax: -495,
                imagePath: '/maps/de_nuke_lower.png',
            },
        },
    },
    de_overpass: {
        name: 'de_overpass',
        material: 'overviews/de_overpass',
        posX: -4831,
        posY: 1781,
        scale: 5.2,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_overpass.png',
        rawInfoPath: '/maps/radar_info/de_overpass.txt',
    },
    de_train: {
        name: 'de_train',
        material: 'overviews/de_train',
        posX: -2308,
        posY: 2078,
        scale: 4.082077,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_train.png',
        rawInfoPath: '/maps/radar_info/de_train.txt',
        verticalSections: {
            default: {
                altitudeMin: -50,
                altitudeMax: 20000,
                imagePath: '/maps/de_train.png',
            },
            lower: {
                altitudeMin: -5000,
                altitudeMax: -50,
                imagePath: '/maps/de_train_lower.png',
            },
        },
    },
    de_vertigo: {
        name: 'de_vertigo',
        material: 'overviews/de_vertigo_radar',
        posX: -3168,
        posY: 1762,
        scale: 4,
        rotate: 0,
        zoom: 0,
        width: RADAR_SIZE,
        height: RADAR_SIZE,
        imagePath: '/maps/de_vertigo.png',
        rawInfoPath: '/maps/radar_info/de_vertigo.txt',
        verticalSections: {
            default: {
                altitudeMin: 11700,
                altitudeMax: 20000,
                imagePath: '/maps/de_vertigo.png',
            },
            lower: {
                altitudeMin: -10000,
                altitudeMax: 11700,
                imagePath: '/maps/de_vertigo_lower.png',
            },
        },
    },
} satisfies Record<string, RadarInfo>;

const MAP_ALIASES: Record<string, keyof typeof RADAR_INFO_BY_MAP> = {
    de_cache_new: 'de_cache',
    de_dust2_v2: 'de_dust2',
};

export type RadarMapName = keyof typeof RADAR_INFO_BY_MAP;

export function normalizeMapName(mapName: string | undefined | null): string {
    const normalized = (mapName ?? '')
        .toLowerCase()
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.replace(/\.bsp$/, '')
        .trim() ?? '';

    if (normalized in RADAR_INFO_BY_MAP) return normalized;
    if (normalized in MAP_ALIASES) return MAP_ALIASES[normalized];

    const knownMaps = Object.keys(RADAR_INFO_BY_MAP).sort((a, b) => b.length - a.length);
    return knownMaps.find(map => normalized.includes(map)) ?? normalized;
}

export function getRadarInfo(mapName: string | undefined | null): RadarInfo | undefined {
    const normalized = normalizeMapName(mapName);
    return RADAR_INFO_BY_MAP[normalized as RadarMapName];
}
