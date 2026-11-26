// World layout constants for Port Solano, the island city of Neon Tides.
// The city is a grid of NB x NB blocks separated by two-lane roads.

export const NB = 7;              // blocks per side
export const PITCH = 80;          // distance between road centerlines
export const ROAD = 16;           // road width
export const SIDEWALK = 4;        // sidewalk ring width inside each block
export const LANE = 3.6;          // lane centre offset from road centreline
export const BLOCK = PITCH - ROAD; // 64: block size including sidewalk
export const CITY = NB * PITCH;   // 560
export const HALF = CITY / 2;     // 280
export const CURB = 0.25;         // sidewalk height

// Island land extents (east side is a wide beach).
export const LAND = { minX: -HALF - 50, maxX: HALF + 120, minZ: -HALF - 50, maxZ: HALF + 50 };
// Wooden pier that sticks out into the ocean from the beach.
export const PIER = { minX: LAND.maxX - 6, maxX: LAND.maxX + 70, minZ: -5, maxZ: 5, y: 0.4 };
export const WATER_Y = -0.6;

export const roadPos = (k) => k * PITCH - HALF;

export function blockBounds(i, j) {
  const x0 = roadPos(i) + ROAD / 2;
  const z0 = roadPos(j) + ROAD / 2;
  return { x0, z0, x1: x0 + BLOCK, z1: z0 + BLOCK, cx: x0 + BLOCK / 2, cz: z0 + BLOCK / 2 };
}

// Special blocks (i = west→east, j = north→south).
export const SPECIAL = {
  police: [1, 1],
  hospital: [4, 5],
  paint: [0, 3],
  bank: [3, 3],
  motel: [6, 5],
  marina: [6, 1],
  parks: [[2, 4], [5, 1]],
  parking: [[3, 5], [5, 3]],
};

export const isSpecial = (i, j, key) => {
  const v = SPECIAL[key];
  if (!v) return false;
  if (Array.isArray(v[0])) return v.some(([a, b]) => a === i && b === j);
  return v[0] === i && v[1] === j;
};

export const PALETTE = {
  neonPink: '#ff3fa4',
  neonCyan: '#29e7ff',
  neonPurple: '#a65bff',
  neonOrange: '#ff8a3d',
  neonGold: '#ffd166',
};

export const CAR_COLORS = [
  '#e8e8ec', '#1b1d22', '#c81e3a', '#1f5fbf', '#f2c230', '#2aa876', '#ff6fb5',
  '#21c7d9', '#8b5cf6', '#f97316', '#9aa3ad', '#7a1f2b', '#0f766e', '#fde68a',
];
