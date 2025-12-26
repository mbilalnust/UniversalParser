import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "./App.css";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const chipLabels = [];

function App() {
  const [status, setStatus] = useState("Ready for document intake.");
  const [fileName, setFileName] = useState(null);
  const [docId, setDocId] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pages, setPages] = useState([]);
  const [markdown, setMarkdown] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPage, setSelectedPage] = useState(null);
  const [activeDoc, setActiveDoc] = useState(null);
  const [excelSheets, setExcelSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const canvasRefs = useRef({});

  useEffect(() => {
    if (!docId || !activeDoc?.isPdf) {
      setPdfDoc(null);
      setPages([]);
      return;
    }

    let cancelled = false;
    const loadPdf = async () => {
      setStatus("Preparing preview...");
      try {
        const pdf = await getDocument({ url: `${API_BASE}/pdf/${docId}` }).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        const pageList = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
        setPages(pageList);
        setSelectedPage(pageList[0] ?? null);
        setStatus("Preview ready. Run parser for markdown output.");
      } catch (error) {
        if (!cancelled) {
          setStatus("Preview failed. Check the backend logs.");
        }
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  useEffect(() => {
    if (!docId || !activeDoc?.isExcel) {
      setExcelSheets([]);
      setSelectedSheet("");
      return;
    }

    let cancelled = false;
    const loadSheets = async () => {
      try {
        const response = await fetch(`${API_BASE}/sheets/${docId}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setExcelSheets(data.sheets || []);
          setSelectedSheet(data.sheets?.[0] || "");
        }
      } catch (error) {
        if (!cancelled) {
          setExcelSheets([]);
          setSelectedSheet("");
        }
      }
    };

    loadSheets();
    return () => {
      cancelled = true;
    };
  }, [docId, activeDoc]);

  useEffect(() => {
    if (!pdfDoc || pages.length === 0) return;

    let cancelled = false;

    const renderPages = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      for (const pageNum of pages) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = canvasRefs.current[pageNum];
        if (!canvas) continue;
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
      }
    };

    renderPages();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pages]);

  const resetOutput = () => {
    setMarkdown(null);
    setPages([]);
    setPdfDoc(null);
    setPageCount(0);
    setDocId(null);
    setSelectedPage(null);
    setActiveDoc(null);
    setExcelSheets([]);
    setSelectedSheet("");
  };

  const uploadFile = async (file) => {
    if (!file) {
      setStatus("Select a file to upload.");
      return;
    }

    setFileName(file.name);
    setIsUploading(true);
    setStatus("Uploading document...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        setStatus("Upload failed. Check the backend logs.");
        return;
      }

      const data = await response.json();
      const newDoc = {
        id: data.id,
        filename: data.filename,
        pageCount: data.page_count,
        contentType: data.content_type,
        extension: data.extension,
        isPdf: (data.extension || "").toLowerCase() === ".pdf",
        isExcel: [".xlsx", ".xlsm"].includes((data.extension || "").toLowerCase()),
      };
      setDocuments((prev) => [newDoc, ...prev]);
      setDocId(data.id);
      setPageCount(data.page_count);
      setSelectedPage(newDoc.isPdf && data.page_count ? 1 : null);
      setActiveDoc(newDoc);
      setSelectedSheet("");
      setMarkdown(null);
      setStatus(
        newDoc.isPdf
          ? `Uploaded ${data.filename} (${data.page_count} pages).`
          : `Uploaded ${data.filename}.`
      );
    } catch (error) {
      setStatus("Upload failed. Ensure the backend is running.");
    } finally {
      setIsUploading(false);
    }
  };

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) {
      setStatus("Select a file to upload.");
      return;
    }

    for (const file of files) {
      // Upload sequentially to keep status updates predictable.
      // eslint-disable-next-line no-await-in-loop
      await uploadFile(file);
    }
  };

  const viewDocument = (doc) => {
    setDocId(doc.id);
    setFileName(doc.filename);
    setPageCount(doc.pageCount);
    setMarkdown(null);
    setSelectedPage(doc.isPdf ? 1 : null);
    setActiveDoc(doc);
    setSelectedSheet("");
    setStatus(`Loaded ${doc.filename}.`);
  };

  const parsePdf = async () => {
    if (!docId) return;
    if (activeDoc?.isPdf && !selectedPage) return;

    setIsParsing(true);
    setStatus(activeDoc?.isPdf ? `Parsing page ${selectedPage}...` : "Parsing document...");

    try {
      let url = activeDoc?.isPdf
        ? `${API_BASE}/parse/${docId}?page=${selectedPage}`
        : `${API_BASE}/parse/${docId}`;
      if (activeDoc?.isExcel && selectedSheet) {
        const joiner = url.includes("?") ? "&" : "?";
        url = `${url}${joiner}sheet=${encodeURIComponent(selectedSheet)}`;
      }
      const response = await fetch(url, {
        method: "POST",
      });

      if (!response.ok) {
        setStatus("Parsing failed. Check backend logs.");
        return;
      }

      const data = await response.json();
      setMarkdown(data.markdown || "No markdown returned.");
      setStatus("Parsing complete. Markdown is ready.");
    } catch (error) {
      setStatus("Parsing failed. Ensure the backend is running.");
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <div className="hero-top">
            <p className="eyebrow">Universal Parser</p>
            <button type="button" className="workspace-btn">
              Workspace integrations
            </button>
          </div>
          <h1>Enterprise-ready document understanding.</h1>
          <p className="subhead">
            Upload PDFs, CSVs, Excel sheets, DOCX, or HTML files, preview PDFs, and extract
            structured output for downstream automation.
          </p>
        </div>
      </header>

      <main className="layout">
        <section className="panel preview-panel">
          <div className="panel-header">
            <div>
              <h2>Document intake</h2>
              <p>Upload PDFs, CSV, Excel, DOCX, or HTML files with policy-ready controls.</p>
            </div>
            <div className="chip-row">
              {chipLabels.map((label) => (
                <span key={label} className="chip">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="status-row">
            <span className="status-pill">{status}</span>
            <span className="status-meta">
              {fileName ? fileName : "No document"}
            </span>
            <span className="status-meta">
              {activeDoc?.isPdf ? `${pageCount} pages` : "Non-PDF"}
            </span>
            <span className="status-meta">
              {activeDoc?.isPdf
                ? selectedPage
                  ? `Selected page ${selectedPage}`
                  : "Select a page"
                : activeDoc?.isExcel && selectedSheet
                ? `Sheet ${selectedSheet}`
                : "No page selection"}
            </span>
          </div>

          <div
            className={`dropzone ${isDragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const droppedFiles = Array.from(event.dataTransfer.files || []);
              if (droppedFiles.length) uploadFiles(droppedFiles);
            }}
          >
            <input
              type="file"
              id="fileInput"
              accept="*/*"
              multiple
            onChange={(event) => uploadFiles(Array.from(event.target.files || []))}
            />
            <label htmlFor="fileInput">
              <strong>Drop PDF, CSV, Excel, DOCX, or HTML files</strong>
              <span>{fileName ? fileName : "or click to browse"}</span>
            </label>
          <div className="actions">
              <button
                type="button"
                onClick={() => document.getElementById("fileInput").click()}
                disabled={isUploading}
              >
                {isUploading ? "Uploading..." : "Browse"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={parsePdf}
                disabled={!docId || (activeDoc?.isPdf && !selectedPage) || isParsing}
              >
                {isParsing
                  ? "Parsing..."
                  : activeDoc?.isPdf
                  ? "Run parser (selected page)"
                  : "Run parser"}
              </button>
            </div>
          </div>

          {activeDoc?.isExcel && docId && (
            <div className="sheet-panel">
              <div>
                <h3>Excel sheets</h3>
                <p>Select a sheet to parse.</p>
              </div>
              <div className="sheet-field">
                <label htmlFor="sheet-select">Sheet</label>
                <select
                  id="sheet-select"
                  value={selectedSheet}
                  onChange={(event) => setSelectedSheet(event.target.value)}
                >
                  {excelSheets.length === 0 && (
                    <option value="">No sheets found</option>
                  )}
                  {excelSheets.map((sheet) => (
                    <option key={sheet} value={sheet}>
                      {sheet}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="docs-header">
            <div>
              <h3>Uploaded documents</h3>
              <p>Select a file to preview and parse.</p>
            </div>
            <div className="meta">
              {documents.length ? `${documents.length} files` : "No uploads yet"}
            </div>
          </div>
          <div className="doc-list">
            {documents.length === 0 && (
              <div className="empty">Upload documents to build a workspace.</div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`doc-card ${docId === doc.id ? "active" : ""}`}
              >
                <div>
                  <div className="doc-title">{doc.filename}</div>
                  <div className="doc-meta">
                    {doc.isPdf ? `${doc.pageCount} pages` : doc.extension || "Document"}
                  </div>
                </div>
                <div className="doc-actions">
                  <button
                    type="button"
                    className={`select-btn ${docId === doc.id ? "active" : ""}`}
                    onClick={() => viewDocument(doc)}
                  >
                    {docId === doc.id ? "Viewing" : "View"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="preview-header">
            <div>
              <h3>Page preview</h3>
              <p>Preview PDF pages before generating markdown.</p>
            </div>
            <div className="meta">
              {fileName ? fileName : "No document loaded"}
            </div>
          </div>

          <div className="pages">
            {!activeDoc?.isPdf && (
              <div className="empty">PDF preview is available after a PDF upload.</div>
            )}
            {activeDoc?.isPdf && pages.length === 0 && (
              <div className="empty">Upload a PDF to see page previews here.</div>
            )}
            {activeDoc?.isPdf &&
              pages.map((pageNum) => (
                <div
                  key={pageNum}
                  className={`page-card ${
                    selectedPage === pageNum ? "selected" : ""
                  }`}
                  onClick={() => setSelectedPage(pageNum)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setSelectedPage(pageNum);
                  }}
                >
                  <div className="page-title">
                    <span>Page {pageNum}</span>
                    <span className="page-meta">
                      {selectedPage === pageNum ? "Selected" : "PDF Preview"}
                    </span>
                  </div>
                  <div className="page-actions">
                    <button
                      type="button"
                      className={`select-btn ${
                        selectedPage === pageNum ? "active" : ""
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPage(pageNum);
                      }}
                    >
                      {selectedPage === pageNum ? "Selected" : "Select page"}
                    </button>
                  </div>
                  <canvas ref={(el) => (canvasRefs.current[pageNum] = el)} />
                </div>
              ))}
          </div>
        </section>

        <section className="panel output-panel">
          <div className="panel-header">
            <div>
              <h2>Markdown output</h2>
              <p>Generated via PyMuPDF for PDFs or direct text extraction for other files.</p>
            </div>
          </div>
          <div className="markdown">
            {markdown ? (
              <pre>{markdown}</pre>
            ) : (
              <div className="empty">Run the parser to see markdown output.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
