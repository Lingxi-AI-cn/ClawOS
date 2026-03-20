varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  if (dist > 0.5) discard;

  // Soft falloff - subtle glow
  float alpha = smoothstep(0.5, 0.05, dist) * vAlpha;

  gl_FragColor = vec4(vColor, alpha);
}
