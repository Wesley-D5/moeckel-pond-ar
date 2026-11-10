"""Build offline QR codes that return to a selected experience."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel

output = Path(sys.argv[1])
for mode in ('wall','print','miniature'):
    qr = QRCode(5, QRErrorCorrectLevel.M)
    qr.addData('https://wesley-d5.github.io/moeckel-pond-ar/#' + mode)
    qr.make()
    modules = qr.getModuleCount()
    scale, quiet = 8, 4
    image = Image.new('RGB', ((modules + 2*quiet)*scale,)*2, 'white')
    draw = ImageDraw.Draw(image)
    for row in range(modules):
        for col in range(modules):
            if qr.isDark(row, col):
                x, y = (col+quiet)*scale, (row+quiet)*scale
                draw.rectangle((x, y, x+scale-1, y+scale-1), fill='#163c30')
    image.save(output / ('phone-'+mode+'.png'), optimize=True)
