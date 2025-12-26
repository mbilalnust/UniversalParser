import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "./App.css";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const chipLabels = [
  "Secure by design",
  "Audit-ready output",
  "Structured markdown",
  "Scales to multi-modal",
];

function App() {
  const [status, setStatus] = useState("Ready for a PDF upload.");
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
  const canvasRefs = useRef({});

  useEffect(() => {
    if (!docId) return;

    let cancelled = false;
    const loadPdf = async () => {
      setStatus("Preparing secure preview...");
      try {
        const pdf = await getDocument({ url: `${API_BASE}/pdf/${docId}` }).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        const pageList = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
        setPages(pageList);
        setSelectedPage(pageList[0] ?? null);
        setStatus("Preview ready. Run Parser for markdown output.");
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
  };

  const uploadPdf = async (file) => {
    if (!file) {
      setStatus("Select a PDF to upload.");
      return;
    }

    setFileName(file.name);
    setIsUploading(true);
    setStatus("Uploading and validating document...");

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
      };
      setDocuments((prev) => [newDoc, ...prev]);
      setDocId(data.id);
      setPageCount(data.page_count);
      setSelectedPage(data.page_count ? 1 : null);
      setMarkdown(null);
      setStatus(`Uploaded ${data.filename} (${data.page_count} pages).`);
    } catch (error) {
      setStatus("Upload failed. Ensure the backend is running.");
    } finally {
      setIsUploading(false);
    }
  };

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) {
      setStatus("Select a PDF to upload.");
      return;
    }

    for (const file of files) {
      // Upload sequentially to keep status updates predictable.
      // eslint-disable-next-line no-await-in-loop
      await uploadPdf(file);
    }
  };

  const viewDocument = (doc) => {
    setDocId(doc.id);
    setFileName(doc.filename);
    setPageCount(doc.pageCount);
    setMarkdown(null);
    setSelectedPage(null);
    setStatus(`Loaded ${doc.filename}.`);
  };

  const parsePdf = async () => {
    if (!docId || !selectedPage) return;

    setIsParsing(true);
    setStatus(`Parsing page ${selectedPage}...`);

    try {
      const response = await fetch(
        `${API_BASE}/parse/${docId}?page=${selectedPage}`,
        {
          method: "POST",
        }
      );

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
              Connect workspace and run batch job
            </button>
          </div>
          <h1>Enterprise-grade document understanding.</h1>
          <p className="subhead">
            Upload a PDF, preview every page, then extract clean markdown built for downstream
            automation.
          </p>
        </div>
      </header>

      <main className="layout">
        <section className="panel preview-panel">
          <div className="panel-header">
            <div>
              <h2>Document intake</h2>
              <p>Securely upload and inspect your PDF in-browser.</p>
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
              {pageCount ? `${pageCount} pages` : "0 pages"}
            </span>
            <span className="status-meta">
              {selectedPage ? `Selected page ${selectedPage}` : "Select a page"}
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
              accept="application/pdf"
              multiple
              onChange={(event) => uploadFiles(Array.from(event.target.files || []))}
            />
            <label htmlFor="fileInput">
              <strong>Drop PDFs here</strong>
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
                disabled={!docId || !selectedPage || isParsing}
              >
                {isParsing ? "Parsing..." : "Run Parser (selected page)"}
              </button>
            </div>
          </div>

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
              <div className="empty">Upload PDFs to build a workspace.</div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`doc-card ${docId === doc.id ? "active" : ""}`}
              >
                <div>
                  <div className="doc-title">{doc.filename}</div>
                  <div className="doc-meta">{doc.pageCount} pages</div>
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
              <p>Inspect each page before generating markdown.</p>
            </div>
            <div className="meta">
              {fileName ? fileName : "No document loaded"}
            </div>
          </div>

          <div className="pages">
            {pages.length === 0 && (
              <div className="empty">Upload a PDF to see page previews here.</div>
            )}
            {pages.map((pageNum) => (
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
              <p>Immediate result from pymupdfllm or PyMuPDF fallback.</p>
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
