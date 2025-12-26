from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from app.services.pdf_parser import parse_pdf_to_markdown

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="UniversalParser")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/upload")
def upload_pdf(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    doc_id = uuid4().hex
    stored_path = DATA_DIR / f"{doc_id}.pdf"

    with stored_path.open("wb") as f:
        content = file.file.read()
        f.write(content)

    try:
        import fitz  # PyMuPDF

        with fitz.open(stored_path) as doc:
            page_count = doc.page_count
    except Exception as exc:
        logger.exception("Failed to read PDF page count: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to read PDF") from exc

    return {
        "id": doc_id,
        "filename": file.filename,
        "page_count": page_count,
    }


@app.get("/pdf/{doc_id}")
def get_pdf(doc_id: str) -> FileResponse:
    stored_path = DATA_DIR / f"{doc_id}.pdf"
    if not stored_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(stored_path, media_type="application/pdf")


@app.post("/parse/{doc_id}")
def parse_pdf(doc_id: str, page: int | None = Query(default=None, ge=1)) -> dict:
    stored_path = DATA_DIR / f"{doc_id}.pdf"
    if not stored_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")

    try:
        markdown = parse_pdf_to_markdown(stored_path, page_number=page)
    except Exception as exc:
        logger.exception("Failed to parse PDF: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to parse PDF") from exc

    return {"id": doc_id, "markdown": markdown, "page": page}
