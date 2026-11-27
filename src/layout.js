// The wider Port Solano coast: everything beyond the original city island.
// Pure data + small geometry helpers, shared by world building, AI, GPS and the maps.

export const WORLD = { minX: -850, maxX: 840, minZ: -760, maxZ: 740 };

// Land polygons (x, z). Holes are water carved out of the land (canals, slips).
export const LANDS = {
  heights: {
    outer: [[-250, -430], [310, -430], [332, -452], [332, -698], [310, -720], [-60, -720], [-60, -690], [-160, -690], [-160, -720], [-250, -720], [-272, -698], [-272, -452]],
    holes: [[[-200, -597], [275, -597], [275, -563], [-200, -563]]],
    top: 'grass',
  },
  harbor: {
    outer: [[-220, 430], [390, 430], [390, 650], [250, 650], [250, 585], [120, 585], [120, 650], [-220, 650]],
    holes: [],
    top: 'concrete',
  },
  lantern: { outer: ringPoly(690, -150, 108, 18), holes: [], top: 'sand' },
};
function ringPoly(cx, cz, r, n) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r + 9 * Math.sin(3 * a) + 5 * Math.cos(5 * a);
    pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return pts;
}

// Bridges: centreline polyline, deck width, cruising height above the water,
// ramp length at each end, and a look. Heights at the ends follow the ground there.
export const BRIDGES = [
  { id: 'coral', name: 'Coral Channel Bridge', style: 'girder', width: 15, height: 7, ramp: 40, points: [[40, -290], [40, -468]] },
  { id: 'sunset', name: 'Sunset Span', style: 'arch', width: 15, height: 8, ramp: 38, points: [[-290, -40], [-428, -40]] },
  { id: 'harbor', name: 'Harbor Bridge', style: 'lift', width: 15, height: 7, ramp: 40, points: [[-120, 290], [-120, 468]] },
  { id: 'causeway', name: 'Long Causeway', style: 'cable', width: 15, height: 9, ramp: 45, points: [[391, -120], [470, -122], [530, -140], [592, -150]] },
  { id: 'canal', name: 'Canal Bridge', style: 'canal', width: 13, height: 1.8, ramp: 26, points: [[40, -538], [40, -622]] },
];

// Road network beyond the city grid. 'g:i,j' refers to a city intersection.
export const ROADS = {
  nodes: {
    // Palm Heights
    P0: [40, -476],
    A0: [-220, -500], A1: [-90, -500], A2: [40, -500], A3: [170, -500], A4: [300, -500],
    B0: [-220, -660], B1: [-90, -660], B2: [40, -660], B3: [170, -660], B4: [300, -660],
    // Sundown Bluffs: coastal loop + switchbacks to the summit
    Q0: [-446, -40], Q1: [-495, -110], Q2: [-565, -160], Q3: [-640, -172], Q4: [-710, -120], Q5: [-738, -30],
    Q6: [-700, 60], Q7: [-630, 112], Q8: [-560, 92], Q9: [-500, 30],
    S1: [-650, -102], S2: [-640, -28], S3: [-622, 42],
    // Harbor District
    H0: [-120, 480], H1: [-190, 480], H2: [60, 480], H3: [240, 480], H4: [360, 480],
    J1: [-190, 560], J2: [60, 560], J4: [360, 560],
    Y1: [-190, 588.5], Y2: [60, 588.5],
    // Long Causeway + Lantern Key loop
    E1: [395, -120], E2: [470, -122], E3: [530, -140], E4: [598, -150],
    K0: [625, -150], K1: [657, -206], K2: [722, -206], K3: [755, -150], K4: [722, -94], K5: [657, -94],
  },
  edges: [
    ['g:4,0', 'P0', 14], ['P0', 'A2', 12],
    ['A0', 'A1', 10], ['A1', 'A2', 10], ['A2', 'A3', 10], ['A3', 'A4', 10],
    ['B0', 'B1', 10], ['B1', 'B2', 10], ['B2', 'B3', 10], ['B3', 'B4', 10],
    ['A0', 'B0', 10], ['A4', 'B4', 10], ['A2', 'B2', 12],
    ['g:0,3', 'Q0', 14],
    ['Q0', 'Q1', 10], ['Q1', 'Q2', 10], ['Q2', 'Q3', 10], ['Q3', 'Q4', 10], ['Q4', 'Q5', 10],
    ['Q5', 'Q6', 10], ['Q6', 'Q7', 10], ['Q7', 'Q8', 10], ['Q8', 'Q9', 10], ['Q9', 'Q0', 10],
    ['Q3', 'S1', 9], ['S1', 'S2', 9], ['S2', 'S3', 9], ['S3', 'Q7', 9],
    ['g:2,7', 'H0', 14],
    ['H1', 'H0', 14], ['H0', 'H2', 14], ['H2', 'H3', 14], ['H3', 'H4', 14],
    ['H1', 'J1', 14], ['H2', 'J2', 14], ['H4', 'J4', 14], ['J1', 'J2', 14], ['J2', 'J4', 14],
    ['J1', 'Y1', 10], ['Y1', 'Y2', 8], ['Y2', 'J2', 10],
    ['g:7,2', 'E1', 12], ['E1', 'E2', 15], ['E2', 'E3', 15], ['E3', 'E4', 15], ['E4', 'K0', 12],
    ['K0', 'K1', 10], ['K1', 'K2', 10], ['K2', 'K3', 10], ['K3', 'K4', 10], ['K4', 'K5', 10], ['K5', 'K0', 10],
  ],
};

export const REGIONS = [
  { id: 'heights', name: 'Palm Heights', tag: 'Canal homes, cul-de-sacs and quiet money', color: '#ff8fc8', at: [40, -580] },
  { id: 'bluffs', name: 'Sundown Bluffs', tag: 'Switchbacks, pines and the best view on the coast', color: '#ffb347', at: [-600, 0] },
  { id: 'harbor', name: 'Harbor District', tag: 'Cranes, containers and cargo nobody checks', color: '#29e7ff', at: [80, 540] },
  { id: 'lantern', name: 'Lantern Key', tag: 'One lighthouse, one resort, no witnesses', color: '#ffd166', at: [690, -150] },
];
export function regionAt(x, z) {
  if (x < -372) return REGIONS[1];
  if (z > 420) return REGIONS[2];
  if (x > 560) return REGIONS[3];
  if (z < -428) return REGIONS[0];
  return null;
}

// ------------------------------------------------------------------ geometry helpers
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function polyBounds(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return { x0, z0, x1, z1 };
}
// grow a simple polygon outward by d (miter offset), for beach rims
export function offsetPoly(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n]; area += x0 * z1 - x1 * z0; }
  const s = area > 0 ? 1 : -1;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [(e1[1] / l1) * s, (-e1[0] / l1) * s], n2 = [(e2[1] / l2) * s, (-e2[0] / l2) * s];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.3, mx * n1[0] + mz * n1[1]));
    return [p[0] + mx * d * k, p[1] + mz * d * k];
  });
}
// distance from (x,z) to segment ab, plus the parameter t along it
export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  const px = ax + dx * t, pz = az + dz * t;
  return { d: Math.hypot(x - px, z - pz), t, px, pz };
}
