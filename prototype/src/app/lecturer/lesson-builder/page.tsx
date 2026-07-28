"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import LessonPackagePreview from "@/components/LessonPackagePreview";
import ContentUploadArea from "@/components/ContentUploadArea";
import QuizValidationPanel, { type QuizQuestion } from "@/components/QuizValidationPanel";

type LessonPackage = {
  summary: string;
  objectives: string[];
  grammarFocus: string[];
  vocabulary: string[];
  quizQuestions?: Array<{ question: string; type: string; options?: string[]; answer: string }>;
  modules: Array<{ title: string; description: string; lessons: Array<{ title: string; description: string; type: string; duration: number }> }>;
  missions: Array<{ title: string; description: string; reward: string }>;
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

export default function LessonBuilderPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("A1");
  const [audience, setAudience] = useState("German learners preparing for speaking and writing tasks");
  const [tone, setTone] = useState("Interactive, gamified, and student-centered");
  const [lessonPackage, setLessonPackage] = useState<LessonPackage | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [saveMode, setSaveMode] = useState("new");
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [parsedContent, setParsedContent] = useState<ParsedContent | null>(null);
  const [showParsedReview, setShowParsedReview] = useState(false);
  const [showQuizValidation, setShowQuizValidation] = useState(false);
  const [validatedQuizzes, setValidatedQuizzes] = useState<QuizQuestion[]>([]);

  const handleQuizzesUpdated = (questions: QuizQuestion[]) => {
    setValidatedQuizzes(questions);
    setShowQuizValidation(false);
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }
    if (status === "authenticated") {
      fetchLecturerCourses();
    }
  }, [status, router]);

  const fetchLecturerCourses = async () => {
    try {
      const res = await fetch("/api/admin/courses");
      if (!res.ok) throw new Error("Failed to load courses");
      const data = await res.json();
      setCourses(data.courses || []);
    } catch (error) {
      console.error("Fetch lecturer courses failed", error);
    }
  };
  const handleContentParsed = (parsed: ParsedContent) => {
    setParsedContent(parsed);
    setValidatedQuizzes(parsed.quizQuestions || []);
    setShowParsedReview(true);
    // Auto-fill form with parsed content
    setTitle(parsed.title || "");
    setDescription(parsed.rawText.slice(0, 200) || "");
    setLevel(parsed.suggestedLevel || "A1");
    setStatusMessage(`✅ Content parsed! Suggested level: ${parsed.suggestedLevel}. Review below and click "Use This Content" to generate the lesson package.`);
  };

  const handleUseParsedContent = async () => {
    if (!parsedContent) return;
    
    setShowParsedReview(false);
    setStatusMessage("");
    setLessonPackage(null);
    setIsGenerating(true);

    try {
      // Generate lesson package using the parsed content
      const response = await fetch("/api/ai/lesson-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lesson: {
            title: parsedContent.title,
            description: parsedContent.rawText,
            level: parsedContent.suggestedLevel,
            audience,
            tone,
            objectives: parsedContent.objectives,
            vocabulary: parsedContent.vocabulary,
            grammarFocus: parsedContent.grammarFocus,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.lessonPackage) {
        throw new Error(data.error || "AI package generation failed.");
      }

      setLessonPackage(data.lessonPackage);
      setValidatedQuizzes(parsedContent.quizQuestions || []);
      setStatusMessage("AI lesson package created from your content. Review it below before saving.");
      setParsedContent(null);
    } catch (error) {
      console.error("Generate package error", error);
      setStatusMessage("Unable to generate the lesson package. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };
  const handleGeneratePackage = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatusMessage("");
    setLessonPackage(null);
    setValidatedQuizzes([]);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/ai/lesson-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lesson: {
            title,
            description,
            level,
            audience,
            tone,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.lessonPackage) {
        throw new Error(data.error || "AI package generation failed.");
      }

      setLessonPackage(data.lessonPackage);
      setStatusMessage("AI lesson package created. Review it below before saving.");
    } catch (error) {
      console.error("Generate package error", error);
      setStatusMessage("Unable to generate the lesson package. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const createModule = async (courseId: string, module: any, order: number) => {
    const moduleRes = await fetch("/api/admin/module", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, title: module.title, description: module.description, order }),
    });
    return moduleRes.json();
  };

  const createLesson = async (moduleId: string, lesson: any, order: number) => {
    const lessonRes = await fetch("/api/admin/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId,
        title: lesson.title,
        description: lesson.description,
        content: lesson.description || lesson.title,
        type: lesson.type || "lesson",
        order,
        duration: lesson.duration || 20,
      }),
    });
    return lessonRes.json();
  };

  const handleSavePackage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lessonPackage) return;
    if (saveMode === "existing" && !selectedCourseId) {
      setStatusMessage("Choose an existing course to apply this package.");
      return;
    }

    setSaving(true);
    setStatusMessage("Saving AI package to your course...");

    try {
      let targetCourseId = selectedCourseId;

      if (saveMode === "new") {
        const courseTitle = title || lessonPackage.summary.slice(0, 40) || "AI Generated Course";
        const courseDescription = description || lessonPackage.summary;
        const courseRes = await fetch("/api/admin/course", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: courseTitle, description: courseDescription, level }),
        });
        const courseData = await courseRes.json();
        if (!courseRes.ok || !courseData.course) {
          throw new Error(courseData.error || "Course creation failed.");
        }
        targetCourseId = courseData.course.id;
      }

      if (!targetCourseId) {
        throw new Error("Unable to determine target course.");
      }

      for (let index = 0; index < lessonPackage.modules.length; index++) {
        const module = lessonPackage.modules[index];
        const moduleJson = await createModule(targetCourseId, module, index + 1);
        if (!moduleJson.module || !moduleJson.module.id) {
          throw new Error(moduleJson.error || "Module creation failed.");
        }
        const moduleId = moduleJson.module.id;

        for (let lessonIndex = 0; lessonIndex < module.lessons.length; lessonIndex++) {
          const lesson = module.lessons[lessonIndex];
          const lessonJson = await createLesson(moduleId, lesson, lessonIndex + 1);
          if (!lessonJson.lesson || !lessonJson.lesson.id) {
            throw new Error(lessonJson.error || "Lesson creation failed.");
          }
        }
      }

      if (validatedQuizzes.length > 0) {
        const quizModuleJson = await createModule(targetCourseId, {
          title: "Quiz & Practice",
          description: "Review questions generated from your lesson package.",
          lessons: [],
        }, lessonPackage.modules.length + 1);

        if (!quizModuleJson.module || !quizModuleJson.module.id) {
          throw new Error(quizModuleJson.error || "Quiz module creation failed.");
        }

        const quizModuleId = quizModuleJson.module.id;
        for (let qIndex = 0; qIndex < validatedQuizzes.length; qIndex++) {
          const quiz = validatedQuizzes[qIndex];
          const lessonJson = await createLesson(quizModuleId, {
            title: `Quiz: ${quiz.question.slice(0, 60)}`,
            description: quiz.question,
            content: `Question: ${quiz.question}\nAnswer: ${quiz.answer}${quiz.options?.length ? `\nOptions: ${quiz.options.join(", ")}` : ""}`,
            type: "quiz",
            order: qIndex + 1,
            duration: 10,
          }, qIndex + 1);

          if (!lessonJson.lesson || !lessonJson.lesson.id) {
            throw new Error(lessonJson.error || "Quiz lesson creation failed.");
          }
        }
      }

      setStatusMessage("AI lesson package saved successfully. Open the course to continue editing.");
      setLessonPackage(null);
      setTitle("");
      setDescription("");
      setAudience("German learners preparing for speaking and writing tasks");
      setTone("Interactive, gamified, and student-centered");
      setValidatedQuizzes([]);
      fetchLecturerCourses();
    } catch (error) {
      console.error("Save package error", error);
      setStatusMessage("Failed to save the package. Try again or check your course permissions.");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center text-[var(--foreground)]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent)] mx-auto"></div>
          <p className="text-[var(--muted)]">Loading AI builder...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] py-10 text-[var(--foreground)]">
      <div className="mx-auto max-w-6xl px-6 md:px-10 space-y-8">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
          <div className="mb-4">
            <Link href="/lecturer" className="text-[var(--accent)] hover:brightness-110 text-sm font-semibold">
              ← Back to lecturer dashboard
            </Link>
          </div>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-4xl font-bold text-[var(--foreground)]">AI Lesson Builder</h1>
              <p className="text-[var(--muted)] mt-2">Generate structured modules, lessons, and missions from a simple course idea.</p>
            </div>
          </div>
        </header>

        {/* Content Upload Section */}
        <ContentUploadArea onContentParsed={handleContentParsed} isLoading={isGenerating} />

        {/* Parsed Content Review */}
        {showParsedReview && parsedContent && (
          <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] border-2 border-[var(--accent)]/50 space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">✅ Content Extracted Successfully</h2>
              <p className="text-[var(--muted)]">Review the parsed information below. Click "Use This Content" to generate a full lesson package.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="font-semibold text-[var(--foreground)] mb-2">Title</h3>
                <p className="text-[var(--muted)] bg-[var(--surface-alt)] p-3 rounded-xl">{parsedContent.title}</p>
              </div>
              <div>
                <h3 className="font-semibold text-[var(--foreground)] mb-2">Suggested Level</h3>
                <p className="text-[var(--muted)] bg-[var(--surface-alt)] p-3 rounded-xl">{parsedContent.suggestedLevel}</p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-[var(--foreground)] mb-2">Learning Objectives</h3>
              <ul className="space-y-1">
                {parsedContent.objectives.map((obj, i) => (
                  <li key={i} className="text-[var(--muted)] text-sm flex gap-2">
                    <span className="text-[var(--accent)]">•</span> {obj}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="font-semibold text-[var(--foreground)] mb-2">Grammar Focus</h3>
                <div className="flex flex-wrap gap-2">
                  {parsedContent.grammarFocus.map((gram, i) => (
                    <span key={i} className="px-3 py-1 bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg text-sm">
                      {gram}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-[var(--foreground)] mb-2">Vocabulary</h3>
                <div className="flex flex-wrap gap-2">
                  {parsedContent.vocabulary.map((word, i) => (
                    <span key={i} className="px-3 py-1 bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg text-sm">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowParsedReview(false)}
                className="flex-1 px-6 py-3 bg-[var(--surface-alt)] text-[var(--foreground)] rounded-xl font-semibold hover:bg-[var(--border)] transition-all"
              >
                Dismiss
              </button>
              <button
                onClick={handleUseParsedContent}
                disabled={isGenerating}
                className="flex-1 px-6 py-3 bg-[var(--accent)] text-white rounded-xl font-semibold hover:brightness-110 transition-all disabled:opacity-50"
              >
                {isGenerating ? "Generating..." : "Use This Content"}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">AI prompt title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Conversational German for everyday travel"
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Brief description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the learning goal, scenario, or skill focus..."
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] resize-none h-28"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Target level</label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="A1">A1</option>
                    <option value="A2">A2</option>
                    <option value="B1">B1</option>
                    <option value="B2">B2</option>
                    <option value="C1">C1</option>
                    <option value="C2">C2</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Learning audience</label>
                  <input
                    type="text"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Tone and style</label>
                <input
                  type="text"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <button
                onClick={handleGeneratePackage}
                disabled={isGenerating}
                className="w-full rounded-2xl bg-[var(--accent)] px-6 py-4 text-sm font-semibold text-[var(--surface)] hover:brightness-110 disabled:opacity-60"
              >
                {isGenerating ? "Generating package..." : "Generate AI lesson package"}
              </button>
              <p className="text-sm text-[var(--muted)]">Your generated package can be saved as a new course or added directly into an existing course.</p>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Save options</h2>
              <div className="mt-4 space-y-4">
                <label className="flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-4">
                  <input type="radio" name="saveMode" value="new" checked={saveMode === "new"} onChange={() => setSaveMode("new")} className="h-4 w-4 text-[var(--accent)]" />
                  <span className="text-sm text-[var(--foreground)]">Create a new course</span>
                </label>
                <label className="flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-4">
                  <input type="radio" name="saveMode" value="existing" checked={saveMode === "existing"} onChange={() => setSaveMode("existing")} className="h-4 w-4 text-[var(--accent)]" />
                  <span className="text-sm text-[var(--foreground)]">Apply into an existing course</span>
                </label>
                {saveMode === "existing" ? (
                  <div>
                    <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Select course</label>
                    <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)} className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]">
                      <option value="">Choose a course</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>{course.title}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <button onClick={handleSavePackage} disabled={!lessonPackage || saving} className="w-full rounded-2xl bg-[var(--foreground)] px-6 py-4 text-sm font-semibold text-[var(--surface)] hover:brightness-110 disabled:opacity-60">
                  {saving ? "Saving package..." : "Save AI package"}
                </button>
                {validatedQuizzes.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowQuizValidation(true)}
                    className="w-full mt-3 rounded-2xl border border-[var(--accent)] px-6 py-4 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all"
                  >
                    Review extracted quiz questions ({validatedQuizzes.length})
                  </button>
                ) : null}
                {statusMessage ? <p className="text-sm text-[var(--muted)]">{statusMessage}</p> : null}
              </div>
            </div>
          </div>
        </div>

        {showQuizValidation && validatedQuizzes.length > 0 ? (
          <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <QuizValidationPanel
              questions={validatedQuizzes}
              vocabulary={lessonPackage?.vocabulary || []}
              grammarFocus={lessonPackage?.grammarFocus || parsedContent?.grammarFocus || []}
              onQuestionsUpdated={handleQuizzesUpdated}
              onClose={() => setShowQuizValidation(false)}
            />
          </div>
        ) : null}

        {lessonPackage ? (
          <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <LessonPackagePreview lessonPackage={lessonPackage} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
