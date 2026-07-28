"use client";

import React, { useRef, useState } from "react";

type QuizQuestion = {
  question: string;
  type: "multiple-choice" | "short-answer" | "true-false" | "fill-in-blank";
  options?: string[];
  answer: string;
};

type ParsedContent = {
  title: string;
  objectives: string[];
  grammarFocus: string[];
  vocabulary: string[];
  quizQuestions: QuizQuestion[];
  keyTopics: string[];
  suggestedLevel: string;
  rawText: string;
  fileName: string;
};

interface ContentUploadAreaProps {
  onContentParsed: (parsed: ParsedContent) => void;
  isLoading?: boolean;
}

export default function ContentUploadArea({ onContentParsed, isLoading = false }: ContentUploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setParsing] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [error, setError] = useState("");
  const [uploadMode, setUploadMode] = useState<"file" | "paste">("file");
  const [analysisMode, setAnalysisMode] = useState<"fast" | "deep">("fast");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseContent = async (content: string, fileName: string = "uploaded-content") => {
    if (!content.trim()) {
      setError("Please provide some content to parse.");
      return;
    }

    setParsing(true);
    setError("");

    try {
      const response = await fetch("/api/ai/upload-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title: fileName, mode: analysisMode }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to parse content");
      }

      onContentParsed(data.parsed);
      setPastedText("");
    } catch (err) {
      console.error("Parse error:", err);
      setError(err instanceof Error ? err.message : "Failed to parse content");
    } finally {
      setParsing(false);
    }
  };

  const parseFile = async (file: File) => {
    setParsing(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      formData.append("mode", analysisMode);
      const response = await fetch("/api/ai/upload-content", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to parse content");
      }

      onContentParsed(data.parsed);
    } catch (err) {
      console.error("Parse error:", err);
      setError(err instanceof Error ? err.message : "Failed to parse content");
    } finally {
      setParsing(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      handleFileSelect(file);
    }
  };

  const handleFileSelect = (file: File) => {
    setError("");

    if (file.size > 20 * 1024 * 1024) {
      setError("File must be smaller than 20MB");
      return;
    }

    const validTypes = ["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(txt|pdf|docx)$/i)) {
      setError("Only TXT, PDF, and DOCX files are supported.");
      return;
    }

    parseFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handlePasteSubmit = () => {
    parseContent(pastedText, "pasted-lesson-content");
  };

  return (
    <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">Upload or Paste Content</h2>
        <p className="text-[var(--muted)]">Add lesson material (TXT file or paste text) and AI will extract structure, vocabulary, and generate quiz questions.</p>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setUploadMode("file");
            setError("");
          }}
          className={`px-4 py-2 rounded-xl font-semibold transition-all ${
            uploadMode === "file"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--surface-alt)] text-[var(--muted)] hover:bg-[var(--border)]"
          }`}
        >
          📁 Upload File
        </button>
        <button
          onClick={() => {
            setUploadMode("paste");
            setError("");
          }}
          className={`px-4 py-2 rounded-xl font-semibold transition-all ${
            uploadMode === "paste"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--surface-alt)] text-[var(--muted)] hover:bg-[var(--border)]"
          }`}
        >
          📝 Paste Text
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">Fast = quick sample; Deep = larger content scan.</p>

      {/* File Upload Area */}
      {uploadMode === "file" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
            isDragging
              ? "border-[var(--accent)] bg-[var(--accent)]/5"
              : "border-[var(--border)] bg-[var(--surface-alt)]/50 hover:border-[var(--accent)]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.docx"
            onChange={handleInputChange}
            className="hidden"
          />
          <div className="space-y-4">
            <div className="text-4xl">📄</div>
            <div>
              <p className="font-semibold text-[var(--foreground)]">Drag and drop a TXT, PDF, or DOCX file here</p>
              <p className="text-sm text-[var(--muted)] mt-1">Or click to browse</p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-6 py-2 bg-[var(--accent)] text-white rounded-xl font-semibold hover:brightness-110 transition-all"
              disabled={isParsing || isLoading}
            >
              {isParsing || isLoading ? "Processing..." : "Select File"}
            </button>
          </div>
        </div>
      )}

      {/* Paste Text Area */}
      {uploadMode === "paste" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Paste your lesson content here</label>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste German lesson content, vocabulary lists, grammar notes, or any text content you want to structure..."
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-4 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] resize-none h-40"
            />
            <p className="text-xs text-[var(--muted)] mt-2">Minimum 100 characters, maximum 50,000 characters</p>
          </div>
          <button
            onClick={handlePasteSubmit}
            disabled={!pastedText.trim() || isParsing || isLoading}
            className="w-full px-6 py-3 bg-[var(--accent)] text-white rounded-xl font-semibold hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isParsing || isLoading ? "Parsing content..." : "Parse Content"}
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-sm">
          <p className="font-semibold">Error</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {/* Parsing Status */}
      {(isParsing || isLoading) && (
        <div className="p-4 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] text-sm">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--accent)]"></div>
            <span>Analyzing content and extracting structure...</span>
          </div>
        </div>
      )}
    </div>
  );
}
