from __future__ import annotations

import logging
from pathlib import Path
import inspect
from typing import Callable, Optional

logger = logging.getLogger(__name__)


def _try_pymupdfllm(file_path: Path, page_number: Optional[int] = None) -> Optional[str]:
    import pymupdf4llm as pymupdfllm  # type: ignore

    candidates: list[str] = [
        "to_markdown",
        "parse_to_markdown",
        "parse_pdf",
        "load_pdf_to_markdown",
    ]

    for name in candidates:
        fn: Optional[Callable[..., str]] = getattr(pymupdfllm, name, None)
        if callable(fn):
            logger.info("Using pymupdfllm.%s", name)
            if page_number is None:
                return fn(str(file_path))
            try:
                signature = inspect.signature(fn)
            except (TypeError, ValueError):
                signature = None
            if signature and "page_number" in signature.parameters:
                return fn(str(file_path), page_number=page_number)
            if signature and "page" in signature.parameters:
                return fn(str(file_path), page=page_number)
            return None

    if hasattr(pymupdfllm, "Document"):
        try:
            doc = pymupdfllm.Document(str(file_path))  # type: ignore[attr-defined]
            if hasattr(doc, "to_markdown"):
                if page_number is None:
                    return doc.to_markdown()
                if hasattr(doc, "page_to_markdown"):
                    return doc.page_to_markdown(page_number)
        except Exception as exc:
            logger.warning("pymupdfllm.Document failed: %s", exc)

    logger.warning("pymupdfllm found but no known markdown entrypoint")
    return None


def _fallback_pymupdf(file_path: Path, page_number: Optional[int] = None) -> str:
    import fitz  # PyMuPDF

    with fitz.open(str(file_path)) as doc:
        if page_number is not None:
            if page_number < 1 or page_number > doc.page_count:
                raise ValueError("Page number out of range")
            page = doc.load_page(page_number - 1)
            text = page.get_text("text").strip()
            if not text:
                text = "_No text found._"
            return f"## Page {page_number}\n\n{text}"

        parts: list[str] = []
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            if not text:
                text = "_No text found._"
            parts.append(f"## Page {i}\n\n{text}")

        return "\n\n".join(parts)


def parse_pdf_to_markdown(file_path: Path, page_number: Optional[int] = None) -> str:
    markdown = _try_pymupdfllm(file_path, page_number=page_number)
    if markdown is not None:
        return markdown

    logger.info("Falling back to PyMuPDF text extraction")
    return _fallback_pymupdf(file_path, page_number=page_number)
