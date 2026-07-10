const EQUIPMENT_ICON_DIRECTORY = '/equipment-icons';

const WEAPON_ICON_FILES: Readonly<Record<string, string>> = {
    'ak-47': 'ak47.svg',
    aug: 'aug.svg',
    awp: 'awp.svg',
    'pp-bizon': 'bizon.svg',
    c4: 'c4.svg',
    'desert eagle': 'deagle.svg',
    'decoy grenade': 'decoy.svg',
    'dual berettas': 'elite.svg',
    famas: 'famas.svg',
    'five-seven': 'fiveseven.svg',
    flashbang: 'flashbang.svg',
    g3sg1: 'g3sg1.svg',
    'galil ar': 'galilar.svg',
    'glock-18': 'glock.svg',
    'he grenade': 'hegrenade.svg',
    p2000: 'p2000.svg',
    'incendiary grenade': 'inferno.svg',
    m249: 'm249.svg',
    m4a4: 'm4a1.svg',
    'mac-10': 'mac10.svg',
    'mag-7': 'mag7.svg',
    molotov: 'inferno.svg',
    mp7: 'mp7.svg',
    'mp5-sd': 'mp5sd.svg',
    mp9: 'mp9.svg',
    negev: 'negev.svg',
    nova: 'nova.svg',
    p250: 'p250.svg',
    p90: 'p90.svg',
    'sawed-off': 'sawedoff.svg',
    'scar-20': 'scar20.svg',
    'sg 553': 'sg556.svg',
    'smoke grenade': 'smokegrenade.svg',
    'ssg 08': 'ssg08.svg',
    'zeus x27': 'taser.svg',
    'tec-9': 'tec9.svg',
    'ump-45': 'ump45.svg',
    xm1014: 'xm1014.svg',
    m4a1: 'm4a1_silencer.svg',
    'm4a1-s': 'm4a1_silencer.svg',
    'cz75 auto': 'cz75a.svg',
    'usp-s': 'usp_silencer.svg',
    'r8 revolver': 'revolver.svg',
    knife: 'knife.svg',
    world: 'icon-death.svg',
    unknown: 'icon-death.svg',
};

export const TIMELINE_ICON_FILES = {
    kill: 'domination.svg',
    smoke: 'smokegrenade.svg',
    flashbang: 'flashbang.svg',
    decoy: 'decoy.svg',
    hegrenade: 'hegrenade.svg',
    molotov: 'inferno.svg',
    incendiary: 'inferno.svg',
    bombPlanted: 'c4.svg',
    bombExploded: 'exploded_c4.svg',
    bombDefused: 'defuser.svg',
    timeExpired: 'time_exp.svg',
    death: 'icon-death.svg',
    headshotDeath: 'kill_headshot.svg',
} as const;

export const KILL_FEED_ICON_FILES = {
    headshot: 'icon_headshot.svg',
    flashAssist: 'flashbang_assist.svg',
    blindKill: 'blind_kill.svg',
    inAirKill: 'inairkill.svg',
    noScope: 'noscope.svg',
    smokeKill: 'smoke_kill.svg',
    penetration: 'penetrate.svg',
} as const;

export function equipmentIconPath(filename: string): string {
    return `${EQUIPMENT_ICON_DIRECTORY}/${filename}`;
}

export function getWeaponIconPath(weaponName: string): string {
    const filename = WEAPON_ICON_FILES[weaponName.trim().toLowerCase()] ?? 'icon-death.svg';
    return equipmentIconPath(filename);
}
