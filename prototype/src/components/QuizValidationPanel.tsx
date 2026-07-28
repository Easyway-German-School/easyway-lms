"use client";

import React, { useState } from "react";

export type QuizQuestion = {
  id?: string;
  question: string;
  type: "multiple-choice" | "short-answer" | "true-false" | "fill-in-blank";
  options?: string[];
  answer: string;
  vocabulary?: string[];
  grammarFocus?: string[];
};

interface QuizValidationPanelProps {
  questions: QuizQuestion[];
  vocabulary: string[];
  grammarFocus: string[];
  onQuestionsUpdated: (questions: QuizQuestion[]) => void;
  onClose?: () => void;
}

export default function QuizValidationPanel({
  questions: initialQuestions,
  vocabulary,
  grammarFocus,
  onQuestionsUpdated,
  onClose,
}: QuizValidationPanelProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    initialQuestions.map((q, i) => ({ ...q, id: q.id || `q_${i}` }))
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newQuestion, setNewQuestion] = useState<QuizQuestion>({
    id: `q_new_${Date.now()}`,
    question: "",
    type: "multiple-choice",
    options: ["", "", "", ""],
    answer: "",
    vocabulary: [],
    grammarFocus: [],
  });

  const handleUpdateQuestion = (id: string, updated: QuizQuestion) => {
    const newQuestions = questions.map((q) => (q.id === id ? updated : q));
    setQuestions(newQuestions);
    setEditingId(null);
  };

  const handleDeleteQuestion = (id: string) => {
    const newQuestions = questions.filter((q) => q.id !== id);
    setQuestions(newQuestions);
  };

  const handleAddQuestion = () => {
    if (!newQuestion.question.trim()) {
      alert("Please enter a question");
      return;
    }
    setQuestions([...questions, { ...newQuestion, id: `q_new_${Date.now()}` }]);
    setNewQuestion({
      id: `q_new_${Date.now()}`,
      question: "",
      type: "multiple-choice",
      options: ["", "", "", ""],
      answer: "",
      vocabulary: [],
      grammarFocus: [],
    });
    setIsAddingNew(false);
  };

  const handleSaveChanges = () => {
    onQuestionsUpdated(questions);
    if (onClose) onClose();
  };

  return (
    <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6 border-2 border-[var(--accent)]/50">
      <div>
        <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">✓ Review Quiz Questions</h2>
        <p className="text-[var(--muted)]">Edit or remove questions before saving. Link questions to vocabulary and grammar concepts.</p>
      </div>

      {/* Questions List */}
      <div className="space-y-4">
        {questions.map((question, idx) => (
          <div
            key={question.id}
            className="rounded-2xl border border-[var(--border)] p-4 bg-[var(--surface-alt)]/50 space-y-3"
          >
            {editingId === question.id ? (
              // Edit Mode
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-[var(--foreground)] block mb-2">Question</label>
                  <input
                    type="text"
                    value={question.question}
                    onChange={(e) =>
                      handleUpdateQuestion(question.id!, { ...question, question: e.target.value })
                    }
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-[var(--foreground)] block mb-2">Type</label>
                    <select
                      value={question.type}
                      onChange={(e) =>
                        handleUpdateQuestion(question.id!, {
                          ...question,
                          type: e.target.value as QuizQuestion["type"],
                        })
                      }
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
                    >
                      <option value="multiple-choice">Multiple Choice</option>
                      <option value="short-answer">Short Answer</option>
                      <option value="true-false">True/False</option>
                      <option value="fill-in-blank">Fill in Blank</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-[var(--foreground)] block mb-2">Correct Answer</label>
                    <input
                      type="text"
                      value={question.answer}
                      onChange={(e) =>
                        handleUpdateQuestion(question.id!, { ...question, answer: e.target.value })
                      }
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                {question.type === "multiple-choice" && (
                  <div>
                    <label className="text-sm font-semibold text-[var(--foreground)] block mb-2">Options</label>
                    <div className="space-y-2">
                      {question.options?.map((opt, i) => (
                        <input
                          key={i}
                          type="text"
                          value={opt || ""}
                          onChange={(e) => {
                            const newOpts = [...(question.options || [])];
                            newOpts[i] = e.target.value;
                            handleUpdateQuestion(question.id!, {
                              ...question,
                              options: newOpts,
                            });
                          }}
                          placeholder={`Option ${i + 1}`}
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-semibold text-[var(--foreground)] block mb-2">Link Vocabulary</label>
                  <div className="flex flex-wrap gap-2">
                    {vocabulary.map((word) => (
                      <button
                        key={word}
                        onClick={() => {
                          const current = question.vocabulary || [];
                          const updated = current.includes(word)
                            ? current.filter((w) => w !== word)
                            : [...current, word];
                          handleUpdateQuestion(question.id!, {
                            ...question,
                            vocabulary: updated,
                          });
                        }}
                        className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                          (question.vocabulary || []).includes(word)
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]"
                        }`}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 px-3 py-2 bg-[var(--surface)] text-[var(--foreground)] rounded-xl font-semibold text-sm hover:bg-[var(--border)] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 px-3 py-2 bg-[var(--accent)] text-white rounded-xl font-semibold text-sm hover:brightness-110 transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              // View Mode
              <div className="space-y-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <p className="font-semibold text-[var(--foreground)]">
                      {idx + 1}. {question.question}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-1">Type: {question.type}</p>
                  </div>
                  <span className="px-2 py-1 bg-[var(--accent)]/20 text-[var(--accent)] rounded-lg text-xs font-semibold">
                    Answer: {question.answer}
                  </span>
                </div>

                {question.options && question.options.length > 0 && (
                  <div className="text-xs text-[var(--muted)] ml-0">
                    <p className="font-semibold mb-1">Options:</p>
                    <ul className="list-disc list-inside">
                      {question.options.map((opt, i) => (
                        <li key={i}>{opt}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(question.vocabulary || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {question.vocabulary?.map((word) => (
                      <span key={word} className="px-2 py-0.5 bg-purple-500/20 text-purple-600 rounded text-xs">
                        {word}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setEditingId(question.id || null)}
                    className="flex-1 px-3 py-1 bg-[var(--surface)] text-[var(--foreground)] rounded-lg text-sm font-semibold hover:bg-[var(--border)] transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteQuestion(question.id!)}
                    className="flex-1 px-3 py-1 bg-red-500/10 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-500/20 transition-all"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add New Question */}
      {isAddingNew ? (
        <div className="rounded-2xl border-2 border-dashed border-[var(--accent)]/50 p-4 bg-[var(--accent)]/5 space-y-4">
          <h3 className="font-semibold text-[var(--foreground)]">Add New Question</h3>
          {/* Similar form as edit mode but for new question */}
          <input
            type="text"
            value={newQuestion.question}
            onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
            placeholder="Enter question"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setIsAddingNew(false)}
              className="flex-1 px-3 py-2 bg-[var(--surface)] text-[var(--foreground)] rounded-xl font-semibold text-sm hover:bg-[var(--border)]"
            >
              Cancel
            </button>
            <button
              onClick={handleAddQuestion}
              className="flex-1 px-3 py-2 bg-[var(--accent)] text-white rounded-xl font-semibold text-sm hover:brightness-110"
            >
              Add Question
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAddingNew(true)}
          className="w-full px-4 py-3 border-2 border-dashed border-[var(--border)] text-[var(--muted)] rounded-2xl font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all"
        >
          + Add Custom Question
        </button>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
        <button
          onClick={() => onClose?.()}
          className="flex-1 px-4 py-3 bg-[var(--surface-alt)] text-[var(--foreground)] rounded-xl font-semibold hover:bg-[var(--border)] transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleSaveChanges}
          className="flex-1 px-4 py-3 bg-[var(--accent)] text-white rounded-xl font-semibold hover:brightness-110 transition-all"
        >
          Save Quiz Questions ({questions.length})
        </button>
      </div>
    </div>
  );
}
