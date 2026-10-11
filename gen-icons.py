"""
Generate PWA icons (192x192, 512x512) for the Mine app.
Uses PIL to draw a simple, clean icon matching the app's aesthetic.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

def draw_icon(size):
    img = Image.new("RGBA", (size, size), (249, 249, 255, 255))
    draw = ImageDraw.Draw(img)

    # Background gradient simulation - radial corners
    # Main rounded square background
    margin = int(size * 0.08)
    radius = int(size * 0.22)
    bg_color = (77, 94, 130, 255)  # #4d5e82 primary

    # Draw rounded rectangle background
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=bg_color
    )

    # Draw a lighter circle in center (like the app's glow effect)
    glow_radius = int(size * 0.28)
    cx, cy = size // 2, size // 2
    for r in range(glow_radius, 0, -1):
        alpha = int(60 * (1 - r / glow_radius))
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=(255, 255, 255, alpha)
        )

    # Draw "M" letter or a symbol
    # Try to use a system font
    font_size = int(size * 0.42)
    font = None
    font_paths = [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            font = ImageFont.truetype(fp, font_size)
            break
    if font is None:
        font = ImageFont.load_default()

    text = "M"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1] - int(size * 0.02)

    draw.text((tx, ty), text, fill=(255, 255, 255, 255), font=font)

    # Small accent dot
    dot_size = int(size * 0.04)
    dot_x = cx + int(size * 0.18)
    dot_y = cy - int(size * 0.18)
    draw.ellipse(
        [dot_x - dot_size, dot_y - dot_size, dot_x + dot_size, dot_y + dot_size],
        fill=(215, 226, 255, 255)  # #d7e2ff pale
    )

    return img

for s in [192, 512]:
    icon = draw_icon(s)
    path = os.path.join(OUTPUT_DIR, f"icon-{s}.png")
    icon.save(path)
    print(f"Generated: {path} ({s}x{s})")
