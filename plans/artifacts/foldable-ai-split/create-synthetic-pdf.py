from pathlib import Path

# 纯合成 PDF：仅含固定坐标文字与矩形，不读真实文档、不引入依赖。
out = Path('/tmp/readany-foldable-browser/synthetic-ai-split.pdf')
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'']
objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
page_ids = []
for page in range(1, 5):
    page_id = len(objects) + 1
    content_id = page_id + 1
    page_ids.append(page_id)
    objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>'.encode())
    lines = ['0.97 0.96 0.92 rg 0 0 600 800 re f', '0.25 0.4 0.6 RG 3 w 36 36 528 728 re S', '0.1 0.1 0.1 rg', f'BT /F1 24 Tf 54 720 Td (SYNTHETIC PDF - PAGE {page}) Tj ET']
    for row in range(1, 20):
        lines.append(f'BT /F1 16 Tf 54 {680-row*26} Td (Page {page} / Line {row:02d}: Fixed coordinates stay unchanged.) Tj ET')
    lines += ['0.25 0.4 0.6 rg 54 80 180 45 re f', '1 1 1 rg BT /F1 14 Tf 65 98 Td (600 x 800 fixed page) Tj ET']
    stream = '\n'.join(lines).encode('ascii')
    objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
objects[1] = f'<< /Type /Pages /Count 4 /Kids [{" ".join(f"{n} 0 R" for n in page_ids)}] >>'.encode()
data = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
offsets = [0]
for n, obj in enumerate(objects, 1):
    offsets.append(len(data))
    data += f'{n} 0 obj\n'.encode() + obj + b'\nendobj\n'
xref = len(data)
data += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
for offset in offsets[1:]:
    data += f'{offset:010d} 00000 n \n'.encode()
data += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
out.write_bytes(data)
print(f'{out}: {len(data)} bytes')
