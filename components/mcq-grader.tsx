"use client";

import React, { useMemo, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Camera,
  ClipboardCheck,
  FileText,
  Loader2,
  RotateCcw,
  CheckCircle2,
  XCircle,
  X,
  SwitchCamera,
} from "lucide-react";

// ---------------- SAMPLE ANSWER KEY ----------------
const SAMPLE_KEY = `1. B
2. D
3. A
4. C`;

// ---------------- HELPERS ----------------
function normalizeChoice(value: string | undefined): string {
  if (!value) return "";
  const clean = String(value).trim().toUpperCase();
  const match = clean.match(/\b([A-H])\b/);
  return match ? match[1] : "";
}

function parseAnswerKey(text: string): Record<number, string> {
  const map: Record<number, string> = {};

  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      // Supports: "1. B", "1: B", "Q1: B", "Q1 B"
      const match = line.match(/(?:Q\s*)?(\d+)\s*[\.:\-]?\s*([A-H])/i);
      if (match) {
        map[Number(match[1])] = normalizeChoice(match[2]);
      }
    });

  return map;
}

function parseResponses(text: string): Record<number, string> {
  const map: Record<number, string> = {};

  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      // Supports: "Q1: B", "1. B", "1: B"
      const match = line.match(/(?:Q\s*)?(\d+)\s*[\.:\-]?\s*([A-H])/i);
      if (match) {
        map[Number(match[1])] = normalizeChoice(match[2]);
      }
    });

  return map;
}



function mergeAnswers(
  existing: string,
  newAnswers: Record<number, string>
): string {
  const map = parseResponses(existing);

  Object.entries(newAnswers).forEach(([q, a]) => {
    if (a) map[Number(q)] = a;
  });

  return Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b)
    .map((q) => `Q${q}: ${map[q]}`)
    .join("\n");
}

interface ResultRow {
  q: number;
  correct: string;
  student: string;
  isCorrect: boolean;
  missing: boolean;
}

interface Results {
  rows: ResultRow[];
  correctCount: number;
  total: number;
  percent: number;
}

function calculateResults(
  answerKey: Record<number, string>,
  responses: Record<number, string>
): Results {
  const questions = Object.keys(answerKey)
    .map(Number)
    .sort((a, b) => a - b);

  const rows = questions.map((q) => {
    const correct = answerKey[q];
    const student = responses[q] || "";
    return {
      q,
      correct,
      student,
      isCorrect: Boolean(student) && student === correct,
      missing: !student,
    };
  });

  const correctCount = rows.filter((row) => row.isCorrect).length;
  const total = rows.length;
  const percent = total ? Math.round((correctCount / total) * 1000) / 10 : 0;

  return { rows, correctCount, total, percent };
}

// ---------------- COMPONENT ----------------
export default function MCQGrader() {
  const [answerKeyText, setAnswerKeyText] = useState(SAMPLE_KEY);
  const [responsesText, setResponsesText] = useState("");
  const [nextQuestion, setNextQuestion] = useState(1);
  const [loadingOCR, setLoadingOCR] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [lastRawOcr, setLastRawOcr] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const answerKey = useMemo(
    () => parseAnswerKey(answerKeyText),
    [answerKeyText]
  );
  const responses = useMemo(() => parseResponses(responsesText), [responsesText]);
  const results = useMemo(
    () => calculateResults(answerKey, responses),
    [answerKey, responses]
  );

  const startCameraStream = useCallback(async (mode: "environment" | "user") => {
    // Stop existing stream if any
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraError("");
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : "Could not access camera"
      );
    }
  }, []);

  const openCamera = useCallback(async () => {
    setCameraError("");
    setCameraOpen(true);
    await startCameraStream(facingMode);
  }, [facingMode, startCameraStream]);

  const switchCamera = useCallback(async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    await startCameraStream(newMode);
  }, [facingMode, startCameraStream]);

  const closeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCameraError("");
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.9);

    closeCamera();
    setLoadingOCR(true);
    setOcrError("");

    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, startQuestion: nextQuestion }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "OCR request failed");
      }

      const { text: rawText } = await response.json();
      setLastRawOcr(rawText);

      const extracted = parseResponses(rawText);
      const extractedCount = Object.keys(extracted).length;

      setResponsesText((prev) => mergeAnswers(prev, extracted));
      setNextQuestion((q) => q + extractedCount);
    } catch (error) {
      setOcrError(
        error instanceof Error ? error.message : "OCR failed. Try a clearer image."
      );
    } finally {
      setLoadingOCR(false);
    }
  }, [closeCamera, nextQuestion]);

  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoadingOCR(true);
    setOcrError("");

    try {
      // Convert file to base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Call API route for OCR
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, startQuestion: nextQuestion }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "OCR request failed");
      }

      const { text: rawText } = await response.json();
      setLastRawOcr(rawText);

      // Parse the OCR response (format: Q1: A, Q2: B, etc.)
      const extracted = parseResponses(rawText);
      const extractedCount = Object.keys(extracted).length;

      setResponsesText((prev) => mergeAnswers(prev, extracted));
      setNextQuestion((q) => q + extractedCount);
    } catch (error) {
      setOcrError(
        error instanceof Error ? error.message : "OCR failed. Try a clearer image."
      );
    } finally {
      setLoadingOCR(false);
      event.target.value = "";
    }
  }

  function resetResponses() {
    setResponsesText("");
    setNextQuestion(1);
    setLastRawOcr("");
    setOcrError("");
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">
                MCQ Grader with Image OCR
              </h1>
              <p className="mt-2 max-w-2xl text-slate-600">
                Upload partial exam pages in order. The app detects circled
                letters A-D, assigns them sequentially, and grades them against
                the answer key.
              </p>
            </div>

            <Card className="rounded-2xl shadow-sm">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-emerald-700">
                  {results.percent}%
                </div>
                <div className="text-sm text-slate-500">
                  {results.correctCount} / {results.total || 0} correct
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="space-y-3 p-5">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <ClipboardCheck className="h-5 w-5" /> Answer Key
              </h2>
              <Textarea
                value={answerKeyText}
                onChange={(event) => setAnswerKeyText(event.target.value)}
                className="min-h-[150px] font-mono"
                placeholder={`1. B\n2. D\n3. A`}
              />
              <p className="text-sm text-slate-500">
                Accepted formats: 1. B, 1: B, Q1: B.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <Upload className="h-5 w-5" /> Upload Student Pages
                </h2>
                {loadingOCR && (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100">
                  <Upload className="h-4 w-4" />
                  Upload Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={loadingOCR}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={loadingOCR}
                  className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  Take Photo
                </button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Next upload starts at question{" "}
                  <span className="font-semibold text-slate-700">
                    Q{nextQuestion}
                  </span>
                  .
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetResponses}
                  className="gap-2 rounded-xl"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>

              {ocrError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {ocrError}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <FileText className="h-5 w-5" /> Parsed Responses
            </h2>
            <Textarea
              value={responsesText}
              onChange={(event) => setResponsesText(event.target.value)}
              className="min-h-[200px] font-mono"
              placeholder={`Q1: B\nQ2: D`}
            />
            <p className="text-sm text-slate-500">
              You can manually edit OCR output before using the score.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <h2 className="mb-4 text-xl font-semibold">Results</h2>
            {results.rows.length === 0 ? (
              <p className="text-sm text-slate-500">
                Add an answer key to see results.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-white">
                <div className="grid grid-cols-4 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                  <div>Question</div>
                  <div>Correct</div>
                  <div>Student</div>
                  <div>Status</div>
                </div>
                {results.rows.map((row) => (
                  <div
                    key={row.q}
                    className="grid grid-cols-4 items-center border-t px-4 py-2 text-sm"
                  >
                    <div className="font-medium">Q{row.q}</div>
                    <div>{row.correct}</div>
                    <div className={row.missing ? "text-slate-400" : ""}>
                      {row.student || "—"}
                    </div>
                    <div>
                      {row.isCorrect ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Correct
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                          <XCircle className="h-3.5 w-3.5" />{" "}
                          {row.missing ? "Missing" : "Wrong"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {lastRawOcr && (
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="space-y-3 p-5">
              <h2 className="text-xl font-semibold">Last Raw OCR Text</h2>
              <Textarea
                value={lastRawOcr}
                readOnly
                className="min-h-[140px] font-mono text-xs"
              />
            </CardContent>
          </Card>
        )}

        <Card className="rounded-2xl border-emerald-200 bg-emerald-50 shadow-sm">
          <CardContent className="space-y-1 p-5 text-sm text-emerald-900">
            <p>Supports circled-letter MCQs A-H</p>
            <p>Works with partial pages uploaded in order</p>
            <p>AI-powered OCR via Baidu Qianfan for accurate extraction</p>
            <p>Teacher-editable output and instant grading</p>
          </CardContent>
        </Card>
      </div>

      {/* Camera Modal */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="relative flex h-full w-full max-w-3xl flex-col items-center justify-center p-4">
            <div className="absolute right-4 top-4 flex gap-2">
              <button
                type="button"
                onClick={switchCamera}
                className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                aria-label="Switch camera"
              >
                <SwitchCamera className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                aria-label="Close camera"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {cameraError ? (
              <div className="rounded-xl bg-red-500/20 p-6 text-center text-white">
                <p className="mb-4">{cameraError}</p>
                <Button onClick={closeCamera} variant="secondary">
                  Close
                </Button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="max-h-[70vh] w-full rounded-xl object-contain"
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="mt-6 flex gap-4">
                  <Button
                    onClick={capturePhoto}
                    size="lg"
                    className="gap-2 rounded-xl bg-emerald-600 px-8 hover:bg-emerald-700"
                  >
                    <Camera className="h-5 w-5" />
                    Capture
                  </Button>
                  <Button
                    onClick={closeCamera}
                    variant="outline"
                    size="lg"
                    className="rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
