// Fit a vertical plane to nearby, independently mapped XR8 feature points.
// Restrict support to the reticle's neighborhood so a wall past a doorway cannot win.
export function measureWall(THREE, camera, worldPoints) {
  camera.updateMatrixWorld()
  const view = new THREE.Vector3()
  const local = []
  for (const {position} of worldPoints || []) {
    const p = new THREE.Vector3(position.x, position.y, position.z)
    const distance = camera.position.distanceTo(p)
    if (distance < 0.28 || distance > 5) continue
    view.copy(p).project(camera)
    if (view.z < -1 || view.z > 1 || Math.abs(view.x) > 0.56 || Math.abs(view.y) > 0.46) continue
    local.push({p, u: view.x, v: view.y, weight: view.x * view.x + view.y * view.y})
  }
  if (local.length < 5) return null
  local.sort((a, b) => a.weight - b.weight)
  const samples = local.slice(0, 36)
  const tolerance = Math.min(0.055, 0.016 + camera.position.distanceTo(samples[0].p) * 0.011)
  let best = []
  let bestScore = 0

  for (let i = 0; i < samples.length; i += 2) {
    const a = samples[i].p
    for (let j = i + 1; j < samples.length; j += 2) {
      const b = samples[j].p
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length = Math.hypot(dx, dz)
      if (length < 0.09) continue
      const inliers = []
      let score = 0
      for (const sample of samples) {
        const error = Math.abs((sample.p.x - a.x) * dz - (sample.p.z - a.z) * dx) / length
        if (error > tolerance) continue
        inliers.push(sample)
        score += (1 - 0.4 * error / tolerance) / (1 + 3 * sample.weight)
      }
      if (inliers.length >= 5 && score > bestScore) {
        best = inliers
        bestScore = score
      }
    }
  }
  if (best.length < 5 || best.length < samples.length * 0.45) return null

  const center = new THREE.Vector3()
  for (const {p} of best) center.add(p)
  center.divideScalar(best.length)
  let xx = 0, zz = 0, xz = 0
  let low = Infinity, high = -Infinity, left = Infinity, right = -Infinity
  let bottom = Infinity, top = -Infinity
  for (const {p, u, v} of best) {
    const dx = p.x - center.x
    const dz = p.z - center.z
    xx += dx * dx
    zz += dz * dz
    xz += dx * dz
    low = Math.min(low, p.y)
    high = Math.max(high, p.y)
    left = Math.min(left, u)
    right = Math.max(right, u)
    bottom = Math.min(bottom, v)
    top = Math.max(top, v)
  }
  // Reject single edges, floor points, narrow clusters and extrapolation beyond the reticle.
  if (high - low < 0.085 || (xx + zz) / best.length < 0.0016 ||
      left > 0.06 || right < -0.06 || bottom > 0.06 || top < -0.06) return null
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz)
  const normal = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle))
  if (normal.dot(camera.position.clone().sub(center)) < 0) normal.negate()
  const direction = camera.getWorldDirection(new THREE.Vector3())
  const incidence = direction.dot(normal)
  if (incidence > -0.32) return null
  const distance = center.sub(camera.position).dot(normal) / incidence
  if (distance < 0.28 || distance > 5) return null
  return {position: camera.position.clone().addScaledVector(direction, distance), normal}
}
