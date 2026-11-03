// Local material response. Flat resting paper retains the PDF's original color.
const clamp = (value) => Math.max(0, Math.min(1, value));

export function paperShade(normal, { front = true, distance = 0, halfWidth = 0, radius = 0 } = {}) {
  if (!(radius > 0)) return 1;
  const length = Math.hypot(...normal);
  if (!length) return 1;
  const sign = front ? 1 : -1;
  const [x, y, z] = normal.map((component) => component / length * sign);
  const light = Math.max(0, (-.35 * x - .3 * y + z) / Math.hypot(-.35, -.3, 1));
  const bend = clamp(1 - Math.abs(z));
  const rise = clamp(2 * radius / .006);
  const reveal = rise * rise * (3 - 2 * rise);
  const curve = .22 * Math.pow(bend, .75) * (1 - .35 * light);
  const contact = front ? 0 : .16 * Math.exp(-Math.max(0, distance - halfWidth) / Math.max(radius * 3.5, .008));
  return 1 - reveal * (curve + contact * (1 - .6 * bend));
}

export const PAPER_LIGHTING_GLSL = `
float paperShade(vec3 rawNormal, bool front, float distance, float halfWidth, float radius) {
  if (radius <= 0.) return 1.;
  vec3 normal = normalize(rawNormal) * (front ? 1. : -1.);
  float light = max(dot(normal, normalize(vec3(-.35,-.3,1.))), 0.);
  float bend = clamp(1.-abs(normal.z), 0., 1.);
  float reveal = smoothstep(0., .006, 2.*radius);
  float curve = .22 * pow(bend, .75) * (1.-.35*light);
  float contact = front ? 0. : .16 * exp(-max(0.,distance-halfWidth)/max(radius*3.5,.008));
  return 1.-reveal*(curve+contact*(1.-.6*bend));
}`;

export function shadeAtVertex(mesh, index, front) {
  const pose = mesh.pose;
  if (!pose) return 1;
  const u = mesh.uvs[index * 2], v = mesh.uvs[index * 2 + 1];
  return paperShade([...mesh.normals.slice(index * 3, index * 3 + 3)], {
    front, radius: pose.radius, halfWidth: pose.halfWidth,
    distance: (u - pose.M.x) * pose.n.x + (v * pose.aspect - pose.M.y) * pose.n.y,
  });
}
