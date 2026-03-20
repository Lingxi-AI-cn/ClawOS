#!/usr/bin/env python3
"""
ClawOS Boot Animation Generator

Generates a cyberpunk-themed boot animation for ClawOS.
Theme: Cyan (#22d3ee) + Purple (#a855f7) on dark background
Content: ClawOS logo fade-in with particle/glow effects

Output: bootanimation.zip in Android bootanimation format
  - desc.txt (animation descriptor)
  - part0/  (logo fade-in frames)
  - part1/  (logo pulse loop)

Resolution: 1080x2280 (Pixel 4 / standard tall phone)
"""

import os
import sys
import math
import random
import zipfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("ERROR: Pillow is required. Install with: pip3 install Pillow")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
WIDTH = 1080
HEIGHT = 2280
FPS = 30
BG_COLOR = (8, 8, 16)  # Very dark blue-black

# Theme colors
CYAN = (34, 211, 238)       # #22d3ee
PURPLE = (168, 85, 247)     # #a855f7
CYAN_DIM = (15, 90, 100)
PURPLE_DIM = (72, 36, 106)
WHITE = (255, 255, 255)

# Animation parameters
FADE_IN_FRAMES = 40       # Part 0: logo fade in
PULSE_FRAMES = 30         # Part 1: logo pulse loop

LOGO_TEXT = "ClawOS"
SUBTITLE_TEXT = "Next-Gen AI Operating System"


def lerp_color(c1, c2, t):
    """Linearly interpolate between two colors."""
    t = max(0, min(1, t))
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def draw_glow_circle(draw, cx, cy, radius, color, alpha_max=80):
    """Draw a soft glow circle using concentric semi-transparent circles."""
    for r in range(radius, 0, -2):
        alpha = int(alpha_max * (r / radius) ** 0.5)
        glow_color = (*color, alpha)
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=glow_color
        )


def draw_particles(draw, frame, total_frames, width, height, seed=42):
    """Draw floating particles."""
    rng = random.Random(seed)
    num_particles = 50

    for i in range(num_particles):
        # Base position
        px = rng.randint(0, width)
        py = rng.randint(0, height)

        # Animate: slow float upward
        offset = (frame * 2 + i * 7) % height
        py = (py - offset) % height

        # Size varies
        size = rng.randint(1, 3)

        # Color: mix of cyan and purple
        t = rng.random()
        color = lerp_color(CYAN_DIM, PURPLE_DIM, t)

        # Fade based on position (dimmer at edges)
        alpha = int(60 * (1 - abs(py - height / 2) / (height / 2)))
        alpha = max(10, alpha)

        particle_color = (*color, alpha)
        draw.ellipse(
            [px - size, py - size, px + size, py + size],
            fill=particle_color
        )


def draw_scan_line(draw, frame, width, height):
    """Draw a horizontal scanning line effect."""
    y = (frame * 8) % height
    for dy in range(-2, 3):
        ly = y + dy
        if 0 <= ly < height:
            alpha = int(30 * (1 - abs(dy) / 3))
            draw.line([(0, ly), (width, ly)], fill=(*CYAN, alpha))


def draw_grid(draw, width, height, alpha=15):
    """Draw a subtle background grid."""
    grid_size = 60
    grid_color = (*CYAN_DIM, alpha)
    for x in range(0, width, grid_size):
        draw.line([(x, 0), (x, height)], fill=grid_color)
    for y in range(0, height, grid_size):
        draw.line([(0, y), (width, y)], fill=grid_color)


def create_frame(frame_num, total_frames, phase="fadein"):
    """Create a single animation frame."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (*BG_COLOR, 255))
    draw = ImageDraw.Draw(img)

    if phase == "fadein":
        progress = frame_num / max(1, total_frames - 1)
    else:
        # Pulse: oscillate between 0.7 and 1.0
        progress = 0.7 + 0.3 * (0.5 + 0.5 * math.sin(frame_num * 2 * math.pi / total_frames))

    # Background grid (subtle)
    draw_grid(draw, WIDTH, HEIGHT, alpha=int(10 * progress))

    # Particles
    draw_particles(draw, frame_num, total_frames, WIDTH, HEIGHT)

    # Scan line
    if progress > 0.3:
        draw_scan_line(draw, frame_num, WIDTH, HEIGHT)

    # Center position
    cx = WIDTH // 2
    cy = HEIGHT // 2 - 100

    # Glow effects behind logo
    glow_alpha = int(60 * progress)
    # Cyan glow (left)
    draw_glow_circle(draw, cx - 80, cy, int(200 * progress), CYAN, glow_alpha)
    # Purple glow (right)
    draw_glow_circle(draw, cx + 80, cy, int(200 * progress), PURPLE, glow_alpha)

    # Logo text
    text_alpha = int(255 * progress)

    # Try to use a good font, fall back to default
    logo_size = 96
    subtitle_size = 28
    try:
        logo_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", logo_size)
        subtitle_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", subtitle_size)
    except (OSError, IOError):
        try:
            logo_font = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", logo_size)
            subtitle_font = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", subtitle_size)
        except (OSError, IOError):
            logo_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()

    # Draw logo text with gradient effect (cyan to purple)
    logo_color = lerp_color(CYAN, WHITE, 0.3)
    logo_color_alpha = (*logo_color, text_alpha)

    # Get text bounding box
    logo_bbox = draw.textbbox((0, 0), LOGO_TEXT, font=logo_font)
    logo_w = logo_bbox[2] - logo_bbox[0]
    logo_h = logo_bbox[3] - logo_bbox[1]
    logo_x = cx - logo_w // 2
    logo_y = cy - logo_h // 2

    # Text shadow/glow
    if progress > 0.2:
        shadow_alpha = int(40 * progress)
        for dx, dy in [(-2, -2), (2, -2), (-2, 2), (2, 2), (0, -3), (0, 3), (-3, 0), (3, 0)]:
            draw.text((logo_x + dx, logo_y + dy), LOGO_TEXT, fill=(*CYAN, shadow_alpha), font=logo_font)

    draw.text((logo_x, logo_y), LOGO_TEXT, fill=logo_color_alpha, font=logo_font)

    # Subtitle
    if progress > 0.5:
        sub_progress = (progress - 0.5) / 0.5
        sub_alpha = int(180 * sub_progress)
        sub_color = (*lerp_color(CYAN_DIM, PURPLE_DIM, 0.5), sub_alpha)

        sub_bbox = draw.textbbox((0, 0), SUBTITLE_TEXT, font=subtitle_font)
        sub_w = sub_bbox[2] - sub_bbox[0]
        sub_x = cx - sub_w // 2
        sub_y = logo_y + logo_h + 30

        draw.text((sub_x, sub_y), SUBTITLE_TEXT, fill=sub_color, font=subtitle_font)

    # Version text at bottom
    if progress > 0.7:
        ver_progress = (progress - 0.7) / 0.3
        ver_alpha = int(100 * ver_progress)
        ver_text = "v0.1.0-dev"
        ver_color = (*CYAN_DIM, ver_alpha)

        ver_bbox = draw.textbbox((0, 0), ver_text, font=subtitle_font)
        ver_w = ver_bbox[2] - ver_bbox[0]
        draw.text((cx - ver_w // 2, HEIGHT - 200), ver_text, fill=ver_color, font=subtitle_font)

    # Horizontal accent lines
    if progress > 0.4:
        line_progress = (progress - 0.4) / 0.6
        line_w = int(300 * line_progress)
        line_alpha = int(60 * line_progress)

        # Line above logo
        line_y_top = logo_y - 30
        draw.line(
            [(cx - line_w, line_y_top), (cx + line_w, line_y_top)],
            fill=(*CYAN, line_alpha), width=1
        )
        # Line below subtitle
        line_y_bot = logo_y + logo_h + 80
        draw.line(
            [(cx - line_w, line_y_bot), (cx + line_w, line_y_bot)],
            fill=(*PURPLE, line_alpha), width=1
        )

    # Convert to RGB (bootanimation doesn't support alpha)
    rgb_img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    rgb_img.paste(img, mask=img.split()[3])
    return rgb_img


def generate_bootanimation(output_dir):
    """Generate all frames and package as bootanimation.zip."""
    output_path = Path(output_dir)
    part0_dir = output_path / "part0"
    part1_dir = output_path / "part1"

    part0_dir.mkdir(parents=True, exist_ok=True)
    part1_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating boot animation ({WIDTH}x{HEIGHT} @ {FPS}fps)...")

    # Part 0: Logo fade-in (play once)
    print(f"  Part 0: {FADE_IN_FRAMES} frames (fade-in)...")
    for i in range(FADE_IN_FRAMES):
        frame = create_frame(i, FADE_IN_FRAMES, "fadein")
        frame.save(part0_dir / f"frame_{i:04d}.png", optimize=True)
        if (i + 1) % 10 == 0:
            print(f"    {i + 1}/{FADE_IN_FRAMES}")

    # Part 1: Logo pulse (loop)
    print(f"  Part 1: {PULSE_FRAMES} frames (pulse loop)...")
    for i in range(PULSE_FRAMES):
        frame = create_frame(i, PULSE_FRAMES, "pulse")
        frame.save(part1_dir / f"frame_{i:04d}.png", optimize=True)
        if (i + 1) % 10 == 0:
            print(f"    {i + 1}/{PULSE_FRAMES}")

    # Create desc.txt
    # Format: WIDTH HEIGHT FPS
    # Then: type count pause dir
    #   type: p (play complete)
    #   count: 0 = infinite, 1 = once
    #   pause: frames to pause after part
    desc_content = f"""{WIDTH} {HEIGHT} {FPS}
p 1 0 part0
p 0 0 part1
"""
    (output_path / "desc.txt").write_text(desc_content)

    # Package as bootanimation.zip (must use STORED, not DEFLATED for frames)
    zip_path = output_path / "bootanimation.zip"
    print(f"  Packaging {zip_path}...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        zf.write(output_path / "desc.txt", "desc.txt")

        for part_dir, part_name in [(part0_dir, "part0"), (part1_dir, "part1")]:
            for png_file in sorted(part_dir.glob("*.png")):
                zf.write(png_file, f"{part_name}/{png_file.name}")

    zip_size = zip_path.stat().st_size / (1024 * 1024)
    print(f"  Done! {zip_path} ({zip_size:.1f} MB)")

    # Cleanup frame directories (keep only the zip)
    import shutil
    shutil.rmtree(part0_dir)
    shutil.rmtree(part1_dir)
    (output_path / "desc.txt").unlink()

    return str(zip_path)


if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output = generate_bootanimation(script_dir)
    print(f"\nBoot animation generated: {output}")
    print("Run '05-setup-device-tree.sh' to deploy to AOSP tree.")
