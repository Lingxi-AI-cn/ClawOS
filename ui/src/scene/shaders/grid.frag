uniform float uTime;
uniform float uIntensity;
uniform vec3 uAccentColor;

varying vec2 vUv;

void main() {
  // Grid lines
  vec2 grid = abs(fract(vUv * 20.0 - 0.5) - 0.5);
  float line = min(grid.x, grid.y);
  float gridAlpha = 1.0 - smoothstep(0.0, 0.05, line);

  // Pulse effect
  float pulse = sin(uTime * 1.5) * 0.5 + 0.5;
  float dist = length(vUv - 0.5) * 2.0;

  // Radial fade
  float radialFade = 1.0 - smoothstep(0.2, 1.0, dist);

  float alpha = gridAlpha * radialFade * (0.03 + uIntensity * 0.06 * pulse);
  vec3 color = uAccentColor;

  gl_FragColor = vec4(color, alpha);
}
