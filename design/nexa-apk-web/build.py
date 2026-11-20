from pathlib import Path
p=Path(__file__).resolve().parent
s=(p/'src/template.html').read_text().replace('__CSS__',(p/'src/style.css').read_text()).replace('__JS__',(p/'src/app.js').read_text())
(p/'index.html').write_text(s)
