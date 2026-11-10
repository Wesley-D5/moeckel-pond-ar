"""Create the matching ten-inch print target. Requires reportlab."""
import argparse
from pathlib import Path
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

URL = "https://wesley-d5.github.io/moeckel-pond-ar/#print"

def make_print(image: Path, output: Path):
    pdf = canvas.Canvas(str(output), pagesize=landscape(letter), pageCompression=1)
    pdf.setTitle("Moeckel Pond — Living Print")
    pdf.setSubject("Print at actual size. The photograph measures 10 inches across.")
    pdf.setFillColor(HexColor("#172E25"))
    pdf.setFont("Helvetica", 8)
    pdf.drawString(36, 578, "MOECKEL POND  /  LIVING PRINT")
    pdf.drawRightString(756, 578, "10 in  /  25.4 cm")
    pdf.drawImage(str(image), 36, 157, width=720, height=405)
    pdf.setFont("Times-Roman", 24)
    pdf.drawString(36, 118, "Moeckel Pond")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(36, 95, "Scan the code with an iPhone or iPad. Open in Safari and tap Animate the print.")
    pdf.drawString(36, 79, "In the AR view, point your camera at the whole picture.")
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(HexColor("#536153"))
    pdf.drawString(36, 46, "PRINT AT ACTUAL SIZE (100%)  /  The photograph should measure 10 inches across.")
    qr = QrCodeWidget(URL, barWidth=85, barHeight=85)
    drawing = Drawing(85, 85)
    drawing.add(qr)
    renderPDF.draw(drawing, pdf, 671, 42)
    pdf.linkURL(URL, (671,42,756,127))
    pdf.showPage()
    pdf.save()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    make_print(args.image, args.output)
