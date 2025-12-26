from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import UploadFile


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class DocumentRecord:
    id: str
    filename: str
    content_type: str
    extension: str
    stored_path: Path
    page_count: Optional[int]

    @property
    def is_pdf(self) -> bool:
        return self.extension.lower() == ".pdf"


def _metadata_path(doc_id: str) -> Path:
    return DATA_DIR / f"{doc_id}.json"


def save_upload(file: UploadFile) -> DocumentRecord:
    extension = Path(file.filename or "").suffix or ""
    doc_id = uuid4().hex
    stored_path = DATA_DIR / f"{doc_id}{extension}"

    with stored_path.open("wb") as f:
        content = file.file.read()
        f.write(content)

    metadata = {
        "id": doc_id,
        "filename": file.filename or stored_path.name,
        "content_type": file.content_type or "application/octet-stream",
        "extension": extension,
        "stored_path": str(stored_path),
    }
    _metadata_path(doc_id).write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    return DocumentRecord(
        id=doc_id,
        filename=metadata["filename"],
        content_type=metadata["content_type"],
        extension=extension,
        stored_path=stored_path,
        page_count=None,
    )


def load_record(doc_id: str) -> DocumentRecord:
    meta_path = _metadata_path(doc_id)
    if meta_path.exists():
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        stored_path = Path(metadata["stored_path"])
        return DocumentRecord(
            id=metadata["id"],
            filename=metadata["filename"],
            content_type=metadata["content_type"],
            extension=metadata.get("extension", ""),
            stored_path=stored_path,
            page_count=None,
        )

    matches = list(DATA_DIR.glob(f"{doc_id}.*"))
    if not matches:
        raise FileNotFoundError("Document metadata not found")
    stored_path = matches[0]
    return DocumentRecord(
        id=doc_id,
        filename=stored_path.name,
        content_type="application/pdf" if stored_path.suffix.lower() == ".pdf" else "application/octet-stream",
        extension=stored_path.suffix,
        stored_path=stored_path,
        page_count=None,
    )
