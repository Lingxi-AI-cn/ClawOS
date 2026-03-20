uniform float uTime;
uniform float uIntensity;
uniform vec3 uAccentColor;
uniform float uState; // 0=idle, 1=thinking, 2=toolCall, 3=responding, 4=error

attribute float aSize;
attribute float aPhase;
attribute vec3 aVelocity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 pos = position;
  float t = uTime;
  float phase = aPhase;

  // Base organic drift (always active)
  pos.x += sin(t * 0.3 + phase * 6.28) * 0.2;
  pos.y += cos(t * 0.2 + phase * 3.14) * 0.15;
  pos.z += sin(t * 0.25 + phase * 4.71) * 0.1;

  // State-based behavior
  if (uState < 0.5) {
    // Idle: gentle float
    pos += aVelocity * sin(t * 0.5 + phase) * 0.3;
  } else if (uState < 1.5) {
    // Thinking: attract toward center
    vec3 toCenter = -pos;
    float dist = length(toCenter);
    float force = uIntensity * 2.0 / (dist + 0.5);
    pos += normalize(toCenter) * force * sin(t * 2.0 + phase) * 0.5;
    // Swirl
    float angle = t * 1.5 + phase * 6.28;
    pos.x += cos(angle) * dist * 0.1;
    pos.z += sin(angle) * dist * 0.1;
  } else if (uState < 2.5) {
    // ToolCall: radial burst
    vec3 fromCenter = normalize(pos + vec3(0.001));
    float burst = sin(t * 3.0 + phase * 6.28) * uIntensity;
    pos += fromCenter * burst * 0.8;
  } else if (uState < 3.5) {
    // Responding: ripple expansion
    float dist = length(pos.xz);
    float wave = sin(dist * 3.0 - t * 2.0 + phase) * uIntensity * 0.4;
    pos.y += wave;
    pos.xz *= 1.0 + wave * 0.1;
  } else {
    // Error: chaotic motion
    pos.x += sin(t * 5.0 + phase * 13.0) * uIntensity * 0.5;
    pos.y += cos(t * 7.0 + phase * 17.0) * uIntensity * 0.4;
    pos.z += sin(t * 6.0 + phase * 11.0) * uIntensity * 0.3;
  }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Size attenuation - keep particles subtle
  float size = aSize * (0.5 + uIntensity * 0.3);
  gl_PointSize = size * (120.0 / -mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 0.5, 16.0);

  // Color: dim accent tint
  vColor = mix(vec3(0.4, 0.5, 0.6), uAccentColor, 0.15 + uIntensity * 0.3);
  vAlpha = 0.04 + uIntensity * 0.15;
}
