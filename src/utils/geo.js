// UTM Zone 15N <-> WGS84 conversion and the local rendering-space transform
// used to place real-world survey geometry (extracted from the cemetery's
// DWG file) onto the 2D map's SVG canvas.
//
// The DWG's coordinates are real UTM Zone 15N meters (verified: contour
// elevations of 1503-1596m match Guatemala City's known elevation, and the
// easting/northing values are consistent with the city's known lat/lng of
// ~14.6349N, -90.5069W projected in zone 15N).
//
// Rendering math stays in projected UTM meters, not lat/lng: the site is
// only ~490m x 465m, far below any UTM distortion threshold, and a flat 2D
// map needs a planar projection anyway. utmToWgs84 exists purely to attach
// portable lat/lng metadata to points, not for rendering.

const UTM_ZONE = 15
const K0 = 0.9996
const WGS84_A = 6378137 // semi-major axis, meters
const E = 0.00669438 // eccentricity squared
const E2 = E * E
const E3 = E2 * E
const E_P2 = E / (1 - E)

const SQRT_E = Math.sqrt(1 - E)
const _E = (1 - SQRT_E) / (1 + SQRT_E)
const _E2 = _E * _E
const _E3 = _E2 * _E
const _E4 = _E3 * _E
const _E5 = _E4 * _E

const M1 = 1 - E / 4 - (3 * E2) / 64 - (5 * E3) / 256
const P2 = (3 / 2) * _E - (27 / 32) * _E3 + (269 / 512) * _E5
const P3 = (21 / 16) * _E2 - (55 / 32) * _E4
const P4 = (151 / 96) * _E3 - (417 / 128) * _E5
const P5 = (1097 / 512) * _E4

function zoneCentralMeridianDeg(zone) {
  return zone * 6 - 183
}

/**
 * Inverse UTM projection (zone 15N, WGS84, northern hemisphere).
 * @returns {{lat:number, lng:number}}
 */
export function utmToWgs84(easting, northing, zone = UTM_ZONE) {
  const x = easting - 500000
  const y = northing

  const m = y / K0
  const mu = m / (WGS84_A * M1)

  const pRad =
    mu +
    P2 * Math.sin(2 * mu) +
    P3 * Math.sin(4 * mu) +
    P4 * Math.sin(6 * mu) +
    P5 * Math.sin(8 * mu)

  const pSin = Math.sin(pRad)
  const pSin2 = pSin * pSin
  const pCos = Math.cos(pRad)
  const pTan = pSin / pCos
  const pTan2 = pTan * pTan
  const pTan4 = pTan2 * pTan2

  const epSin = 1 - E * pSin2
  const epSinSqrt = Math.sqrt(1 - E * pSin2)

  const n = WGS84_A / epSinSqrt
  const r = (1 - E) / epSin

  const c = E_P2 * pCos * pCos
  const c2 = c * c

  const d = x / (n * K0)
  const d2 = d * d
  const d3 = d2 * d
  const d4 = d3 * d
  const d5 = d4 * d
  const d6 = d5 * d

  const latitude =
    pRad -
    (pTan / r) *
      (d2 / 2 - (d4 / 24) * (5 + 3 * pTan2 + 10 * c - 4 * c2 - 9 * E_P2)) +
    (d6 / 720) * (61 + 90 * pTan2 + 298 * c + 45 * pTan4 - 252 * E_P2 - 3 * c2)

  const longitude =
    (d -
      (d3 / 6) * (1 + 2 * pTan2 + c) +
      (d5 / 120) * (5 - 2 * c + 28 * pTan2 - 3 * c2 + 8 * E_P2 + 24 * pTan4)) /
    pCos

  const lonOriginRad = (zoneCentralMeridianDeg(zone) * Math.PI) / 180

  return {
    lat: (latitude * 180) / Math.PI,
    lng: ((longitude + lonOriginRad) * 180) / Math.PI,
  }
}

/**
 * Build the affine transform from UTM meters to a real-aspect-ratio SVG
 * viewBox, given the site's extracted UTM extent.
 * @param {{min_utm:[number,number], max_utm:[number,number], width_m:number, height_m:number}} siteExtent
 * @param {number} viewboxTarget  desired size (in viewBox units) for the longer axis
 * @param {number} padding        margin (in viewBox units) around the site
 */
export function computeTransform(siteExtent, viewboxTarget = 1000, padding = 40) {
  const { width_m: widthM, height_m: heightM, min_utm: minUtm, max_utm: maxUtm } = siteExtent
  const usable = viewboxTarget - padding * 2
  const scale = usable / Math.max(widthM, heightM)

  return {
    minUtm,
    maxUtm,
    scale,
    padding,
    viewboxW: padding * 2 + widthM * scale,
    viewboxH: padding * 2 + heightM * scale,
  }
}

/**
 * Convert a UTM point to local SVG-space coordinates using a transform from
 * computeTransform(). Y is flipped: UTM northing increases northward, SVG y
 * increases downward, so "up" on screen stays true north.
 */
export function utmToLocal(easting, northing, transform) {
  const { minUtm, maxUtm, scale, padding } = transform
  return {
    x: padding + (easting - minUtm[0]) * scale,
    y: padding + (maxUtm[1] - northing) * scale,
  }
}

/** Inverse of utmToLocal. */
export function localToUtm(x, y, transform) {
  const { minUtm, maxUtm, scale, padding } = transform
  return {
    easting: minUtm[0] + (x - padding) / scale,
    northing: maxUtm[1] - (y - padding) / scale,
  }
}
