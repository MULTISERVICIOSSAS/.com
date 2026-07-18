import hashlib
import unittest
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for name in ("src", "href", "poster"):
            if values.get(name):
                self.references.append(values[name])


class StaticAssetTests(unittest.TestCase):
    def test_local_html_references_exist(self):
        missing = []
        for html_file in PUBLIC.rglob("*.html"):
            parser = AssetParser()
            parser.feed(html_file.read_text(encoding="utf-8", errors="replace"))
            for reference in parser.references:
                parsed = urllib.parse.urlparse(reference)
                if parsed.scheme or parsed.netloc or reference.startswith(("#", "data:", "mailto:", "tel:", "javascript:")):
                    continue
                raw_path = urllib.parse.unquote(parsed.path)
                if not raw_path or "{{" in raw_path or "${" in raw_path:
                    continue
                target = (PUBLIC / raw_path.lstrip("/")) if raw_path.startswith("/") else (html_file.parent / raw_path)
                target = target.resolve()
                if target.is_dir():
                    target = target / "index.html"
                if not target.exists():
                    missing.append(f"{html_file.relative_to(PUBLIC)} -> {reference}")
        self.assertEqual(missing, [], "Referencias locales faltantes:\n" + "\n".join(missing))

    def test_admin_pages_use_official_logo(self):
        pages = [
            PUBLIC / "admin" / "login.html",
            PUBLIC / "admin" / "dashboard.html",
            PUBLIC / "admin" / "gestion.html",
            PUBLIC / "admin" / "certificados-admin.html",
            PUBLIC / "admin" / "prospectos.html",
            PUBLIC / "admin" / "generador-certificados" / "index.html",
            PUBLIC / "admin" / "generador-certificados-medicos" / "index.html",
        ]
        for page in pages:
            content = page.read_text(encoding="utf-8")
            with self.subTest(page=page.name):
                self.assertIn("logo-horizontal.png", content)

    def test_carnet_pdf_uses_printable_a4_layout(self):
        generator = (PUBLIC / "admin" / "generador-certificados" / "index.html").read_text(encoding="utf-8")
        self.assertIn("orientation: 'portrait'", generator)
        self.assertIn("var carnetWidth = 85.6", generator)
        self.assertIn("drawCarnetCutMarks", generator)
        self.assertIn("pdf.addPage('a4', 'landscape')", generator)

    def test_medical_generator_only_requests_patient_identity(self):
        generator = (PUBLIC / "admin" / "generador-certificados-medicos" / "index.html").read_text(encoding="utf-8")
        parser = AssetParser()
        parser.feed(generator)
        form_fields = []
        for tag in ("input", "select", "textarea"):
            marker = f"<{tag} "
            form_fields.extend(part.split('id="', 1)[1].split('"', 1)[0] for part in generator.split(marker)[1:] if 'id="' in part)
        self.assertEqual(form_fields, ["patientName", "documentNumber", "documentType"])
        self.assertIn("const medicalDefaults = Object.freeze", generator)
        self.assertIn("expiryFrom(examDate)", generator)
        self.assertIn("await verifyPublicRecord(data)", generator)
        self.assertIn("assets/templates/certificado-medico-base.png", generator)
        self.assertIn("https://multiservicios.website/validar-certificado.html?codigo=", generator)
        original = PUBLIC / "assets" / "templates" / "certificado-medico-original.pdf"
        self.assertTrue(original.exists())
        self.assertEqual(
            hashlib.sha256(original.read_bytes()).hexdigest(),
            "3e18dd9aec76512f6229d260ba748f4bee465e470bf3eac5ae922e188f0a1141",
        )

    def test_course_randomizes_options_without_changing_answer_ids(self):
        course = (PUBLIC / "apps" / "modulos-examen" / "index.html").read_text(encoding="utf-8")
        self.assertIn("function shuffledOptions(options)", course)
        self.assertIn("checkModuleAnswer(${option.originalIndex})", course)
        self.assertIn('value="${option.originalIndex}"', course)

    def test_final_exam_includes_colombian_study_library(self):
        course = (PUBLIC / "apps" / "modulos-examen" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Biblioteca de repaso", course)
        self.assertIn("exam-study-layout", course)
        self.assertIn("Resolución 2674 de 2013", course)
        self.assertIn("www.minsalud.gov.co", course)
        self.assertIn("normograma.invima.gov.co", course)
        self.assertIn("temperature-scale", course)


if __name__ == "__main__":
    unittest.main()
