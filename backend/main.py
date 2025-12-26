from __future__ import annotations

import logging

from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from config import apply_llm_overrides, get_settings
from services.document_parser import list_excel_sheets, list_pptx_slides, parse_document
from services.storage import load_record, save_upload

logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(title="UniversalParser")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


class LLMOverrides(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None


@app.post("/upload")
def upload_pdf(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    record = save_upload(file)
    page_count = None

    if record.is_pdf:
        try:
            import fitz  # PyMuPDF

            with fitz.open(record.stored_path) as doc:
                page_count = doc.page_count
        except Exception as exc:
            logger.exception("Failed to read PDF page count: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to read PDF") from exc

    return {
        "id": record.id,
        "filename": record.filename,
        "page_count": page_count or 0,
        "content_type": record.content_type,
        "extension": record.extension,
    }


@app.get("/pdf/{doc_id}")
def get_pdf(doc_id: str) -> FileResponse:
    try:
        record = load_record(doc_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="PDF not found")
    if not record.is_pdf or not record.stored_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(record.stored_path, media_type="application/pdf")


@app.get("/sheets/{doc_id}")
def get_sheets(doc_id: str) -> dict:
    try:
        record = load_record(doc_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found")

    if record.extension.lower() not in {".xlsx", ".xlsm"}:
        raise HTTPException(status_code=400, detail="Sheets are only available for Excel files")

    try:
        sheets = list_excel_sheets(record.stored_path)
    except Exception as exc:
        logger.exception("Failed to list sheets: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list sheets") from exc

    return {"id": record.id, "sheets": sheets}


@app.get("/slides/{doc_id}")
def get_slides(doc_id: str) -> dict:
    try:
        record = load_record(doc_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found")

    if record.extension.lower() != ".pptx":
        raise HTTPException(status_code=400, detail="Slides are only available for PPTX files")

    try:
        slides = list_pptx_slides(record.stored_path)
    except Exception as exc:
        logger.exception("Failed to list slides: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list slides") from exc

    return {"id": record.id, "slides": slides}


@app.post("/parse/{doc_id}")
def parse_pdf(
    doc_id: str,
    page: int | None = Query(default=None, ge=1),
    sheet: str | None = Query(default=None),
    slide: int | None = Query(default=None, ge=1),
    overrides: LLMOverrides | None = Body(default=None),
) -> dict:
    try:
        record = load_record(doc_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        llm_config = settings.llm
        if overrides and not record.is_pdf:
            llm_config = apply_llm_overrides(settings.llm, overrides.model_dump(exclude_none=True))
        markdown = parse_document(
            record,
            page_number=page,
            llm_config=llm_config,
            sheet_name=sheet,
            slide_number=slide,
        )
    except Exception as exc:
        logger.exception("Failed to parse document: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to parse document") from exc

    return {
        "id": record.id,
        "markdown": markdown,
        "page": page,
        "content_type": record.content_type,
        "extension": record.extension,
    }
