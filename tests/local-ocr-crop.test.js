const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.join(__dirname, '..', 'tools', 'local_ocr_demo.py');

const result = spawnSync('python3', ['-'], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8',
  input: `
import importlib.util
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("local_ocr_demo", "${scriptPath}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

tmp_dir = Path(tempfile.mkdtemp())
image_path = tmp_dir / "captcha-row.png"
image = Image.new("RGB", (320, 96), "white")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 14, 312, 78), radius=12, outline=(220, 220, 220), width=2, fill=(255, 255, 255))
draw.text((28, 36), "input", fill=(180, 180, 180))
draw.rounded_rectangle((210, 24, 300, 68), radius=12, fill=(0, 0, 0))
draw.text((230, 35), "9954", fill=(255, 255, 255))
image.save(image_path)

box = mod.detect_dark_captcha_crop(image_path)
assert box is not None, "Expected dark captcha crop box"
x1, y1, x2, y2 = box
assert x1 >= 190, box
assert x2 <= 310, box
assert y1 <= 28, box
assert y2 >= 64, box
print(box)
`,
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.ok(result.stdout.trim(), 'OCR crop test should print the detected crop box.');

console.log('local OCR crop checks passed');
