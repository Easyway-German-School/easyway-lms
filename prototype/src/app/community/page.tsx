"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

interface Course {
  id: string;
  title: string;
  level?: string;
}

interface User {
  id: string;
  name: string;
}

interface Reply {
  id: string;
  content: string;
  user: User;
  createdAt: string;
}

interface Discussion {
  id: string;
  title: string;
  content: string;
  courseId: string;
  pinned: boolean;
  user: User;
  course: Course;
  replies: Reply[];
  createdAt: string;
}

async function fetchChannels() {
  const res = await fetch("/api/community/channels");
  if (!res.ok) throw new Error("Failed to load community channels");
  return res.json() as Promise<Course[]>;
}

async function fetchDiscussions(courseId: string | null | undefined) {
  const url = courseId ? `/api/community/discussions?courseId=${encodeURIComponent(courseId)}` : "/api/community/discussions";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load discussions");
  return res.json() as Promise<Discussion[]>;
}

async function createDiscussion(courseId: string, title: string, content: string) {
  const res = await fetch("/api/community/discussions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courseId, title, content }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Failed to create discussion");
  }

  return res.json() as Promise<Discussion>;
}

async function createReply(discussionId: string, content: string) {
  const res = await fetch("/api/community/replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discussionId, content }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Failed to add reply");
  }

  return res.json() as Promise<Reply>;
}

async function deleteReplyApi(id: string) {
  const res = await fetch("/api/community/replies", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Failed to delete reply");
  }

  return res.json();
}

export default function CommunityPage() {
  const { data: session, status } = useSession();
  const sessionUser = session?.user as { id?: string; name?: string | null; role?: string } | undefined;
  const isAdmin = sessionUser?.role?.toLowerCase() === "admin";
  const [selectedCourseId, setSelectedCourseId] = useState<string | null | undefined>(undefined);
  const [discussionCourseId, setDiscussionCourseId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [newDiscussion, setNewDiscussion] = useState({ title: "", content: "" });
  const [showNewDiscussion, setShowNewDiscussion] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const queryClient = useQueryClient();

  const {
    data: courses,
    isLoading: loadingCourses,
    isError: channelsError,
  } = useQuery<Course[], Error>({
    queryKey: ["communityChannels"],
    queryFn: fetchChannels,
  });

  const selectedKey = useMemo(() => selectedCourseId ?? "__all__", [selectedCourseId]);

  const {
    data: discussions,
    isLoading: loadingDiscussions,
    isError: discussionsError,
    isFetching: discussionsFetching,
  } = useQuery<Discussion[], Error>({
    queryKey: ["communityDiscussions", selectedKey],
    queryFn: () => fetchDiscussions(selectedCourseId),
    enabled: selectedCourseId !== undefined,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const createDiscussionMutation = useMutation({
    mutationFn: ({ courseId, title, content }: { courseId: string; title: string; content: string }) =>
      createDiscussion(courseId, title, content),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["communityDiscussions", selectedKey] });
      const previous = queryClient.getQueryData<Discussion[]>(["communityDiscussions", selectedKey]);

      if (previous) {
        const course = courses?.find((item) => item.id === payload.courseId);
        const optimisticDiscussion: Discussion = {
          id: `optimistic-${Date.now()}`,
          courseId: payload.courseId,
          title: payload.title,
          content: payload.content,
          pinned: false,
          user: {
            id: sessionUser?.id ?? "me",
            name: sessionUser?.name ?? "You",
          },
          course: course ?? { id: payload.courseId, title: "Community", level: undefined },
          replies: [],
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<Discussion[]>(["communityDiscussions", selectedKey], [...previous, optimisticDiscussion]);
      }

      return { previous };
    },
    onSuccess: () => {
      setFeedback({ type: "success", text: "Discussion posted to the community." });
    },
    onError: (err, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["communityDiscussions", selectedKey], context.previous);
      }
      setError(err instanceof Error ? err.message : "Failed to create discussion");
      setFeedback({ type: "error", text: "We could not post your discussion right now." });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["communityDiscussions", selectedKey] });
    },
  });

  const createReplyMutation = useMutation({
    mutationFn: ({ discussionId, content }: { discussionId: string; content: string }) =>
      createReply(discussionId, content),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["communityDiscussions", selectedKey] });
      const previous = queryClient.getQueryData<Discussion[]>(["communityDiscussions", selectedKey]);

      if (previous) {
        queryClient.setQueryData<Discussion[]>(["communityDiscussions", selectedKey],
          previous.map((discussion) =>
            discussion.id === payload.discussionId
              ? {
                  ...discussion,
                  replies: [
                    ...discussion.replies,
                    {
                      id: `optimistic-reply-${Date.now()}`,
                      content: payload.content,
                      user: {
                        id: sessionUser?.id ?? "me",
                        name: sessionUser?.name ?? "You",
                      },
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : discussion
          )
        );
      }

      return { previous };
    },
    onSuccess: () => {
      setFeedback({ type: "success", text: "Reply added to the discussion." });
    },
    onError: (err, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["communityDiscussions", selectedKey], context.previous);
      }
      setError(err instanceof Error ? err.message : "Failed to add reply");
      setFeedback({ type: "error", text: "We could not add your reply right now." });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["communityDiscussions", selectedKey] });
    },
  });

  const deleteReplyMutation = useMutation({
    mutationFn: (id: string) => deleteReplyApi(id),
    onMutate: async (replyId) => {
      await queryClient.cancelQueries({ queryKey: ["communityDiscussions", selectedKey] });
      const previous = queryClient.getQueryData<Discussion[]>(["communityDiscussions", selectedKey]);

      if (previous) {
        queryClient.setQueryData<Discussion[]>(["communityDiscussions", selectedKey],
          previous.map((discussion) => ({
            ...discussion,
            replies: discussion.replies.filter((reply) => reply.id !== replyId),
          }))
        );
      }

      return { previous };
    },
    onSuccess: () => {
      setFeedback({ type: "success", text: "Reply removed." });
    },
    onError: (err, _replyId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["communityDiscussions", selectedKey], context.previous);
      }
      setError(err instanceof Error ? err.message : "Failed to delete reply");
      setFeedback({ type: "error", text: "We could not delete that reply right now." });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["communityDiscussions", selectedKey] });
    },
  });

  useEffect(() => {
    if (channelsError) setError("Unable to load community channels.");
  }, [channelsError]);

  useEffect(() => {
    if (discussionsError) setError("Unable to load discussions.");
  }, [discussionsError]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (courses && courses.length > 0 && selectedCourseId === undefined) {
      setSelectedCourseId(courses[0].id);
      setDiscussionCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  const selectedCourse = useMemo(
    () => courses?.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId]
  );

  const channelLabel = selectedCourse ? selectedCourse.level || selectedCourse.title : "All available";
  const currentDiscussions = discussions ?? [];
  const discussionCount = currentDiscussions.length;
  const pinnedCount = currentDiscussions.filter((discussion) => discussion.pinned).length;
  const isDiscussionBusy = loadingDiscussions || discussionsFetching;
  const showEmptyView = !isDiscussionBusy && currentDiscussions.length === 0;
  const isViewingAllSpaces = selectedCourseId === null;
  const emptyStateTitle = isViewingAllSpaces
    ? "No discussions across your available spaces yet"
    : "This channel is waiting for its first conversation";
  const emptyStateDescription = isViewingAllSpaces
    ? "Start the first thread and invite your learners into the conversation."
    : "Start a discussion and invite your level community in.";

  function handleSelectChannel(courseId: string | null) {
    setSelectedCourseId(courseId);
    setDiscussionCourseId(courseId ?? "");
    setExpandedId(null);
    setReplyingTo(null);
    setReplyContent("");
    setError("");
    setFeedback(null);
  }

  function handleCreateDiscussion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const courseIdToPost = discussionCourseId || selectedCourseId;

    if (!courseIdToPost || !newDiscussion.title.trim() || !newDiscussion.content.trim()) {
      setError("Please fill in all fields and choose a community channel.");
      return;
    }

    setError("");
    createDiscussionMutation.mutate({
      courseId: courseIdToPost,
      title: newDiscussion.title.trim(),
      content: newDiscussion.content.trim(),
    });
    setNewDiscussion({ title: "", content: "" });
    setShowNewDiscussion(false);
  }

  function handleAddReply(discussionId: string) {
    if (!replyContent.trim()) return;

    setError("");
    createReplyMutation.mutate({ discussionId, content: replyContent.trim() });
    setReplyContent("");
    setReplyingTo(null);
  }

  function handleDeleteReply(replyId: string) {
    if (!confirm("Delete this reply?")) return;
    setError("");
    deleteReplyMutation.mutate(replyId);
  }

  if (status === "loading") {
    return <div className="p-8 text-center">Checking session...</div>;
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-xl font-semibold">Please sign in to access the community.</p>
      </div>
    );
  }

  if (loadingCourses || selectedCourseId === undefined) {
    return <div className="p-8 text-center">Loading community channels...</div>;
  }

  if (!courses?.length) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_transparent_35%),linear-gradient(135deg,_#f8fafc_0%,_#ecfdf5_100%)] p-6 sm:p-8">
        <div className="mx-auto max-w-4xl rounded-[32px] bg-white p-10 text-center shadow-xl">
          <h1 className="text-3xl font-semibold text-slate-950">Community access not available</h1>
          <p className="mt-4 text-slate-600">Your account does not currently have access to any community channels. Please check your enrollment or contact support.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_transparent_35%),linear-gradient(135deg,_#f8fafc_0%,_#ecfdf5_100%)] p-6 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[32px] bg-slate-950 p-7 text-white shadow-xl sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">Easyway community</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Your learning spaces</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Discuss lessons, ask questions, and connect with learners and lecturers in the course communities available to your account.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {feedback && (
          <div className={`mb-4 rounded-2xl border p-4 text-sm ${feedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            {feedback.text}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Channels</p>
            <div className="mt-3 space-y-1">
              <button type="button" onClick={() => handleSelectChannel(null)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold ${selectedCourseId === null ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-50"}`}>
                <span className="text-lg">#</span> All spaces
              </button>
              {courses.map((course) => (
                <button key={course.id} type="button" onClick={() => handleSelectChannel(course.id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm ${selectedCourseId === course.id ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-600 hover:bg-slate-50"}`}>
                  <span className="text-lg">#</span>
                  <span className="min-w-0 truncate">{course.level || course.title}</span>
                </button>
              ))}
            </div>
            <p className="mt-5 rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">Only the level communities available to your account appear here.</p>
          </aside>

          <section>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">{channelLabel}</p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-950">Discussion channels</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{discussionCount} discussions</span>
                  {pinnedCount > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">{pinnedCount} pinned</span>}
                </div>
              </div>
              <button type="button" onClick={() => setShowNewDiscussion((current) => !current)} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
                {showNewDiscussion ? "Close composer" : "Start discussion"}
              </button>
            </div>

            {showNewDiscussion && (
              <div className="mb-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold mb-4">Create Discussion</h2>
                <form onSubmit={handleCreateDiscussion} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Community *</label>
                    <select
                      value={discussionCourseId}
                      onChange={(e) => setDiscussionCourseId(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2"
                      required
                    >
                      <option value="" disabled>Select community channel</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.level ? `${course.level} community` : course.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Title *</label>
                    <input
                      type="text"
                      value={newDiscussion.title}
                      onChange={(e) => setNewDiscussion({ ...newDiscussion, title: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Discussion *</label>
                    <textarea
                      value={newDiscussion.content}
                      onChange={(e) => setNewDiscussion({ ...newDiscussion, content: e.target.value })}
                      className="h-32 w-full rounded-2xl border border-slate-200 px-3 py-2"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={createDiscussionMutation.isPending}
                    className="rounded-2xl bg-slate-950 px-4 py-2 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createDiscussionMutation.isPending ? "Posting..." : "Post Discussion"}
                  </button>
                </form>
              </div>
            )}

            {isDiscussionBusy && currentDiscussions.length === 0 ? (
              <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
                <div className="animate-pulse space-y-4">
                  <div className="h-4 w-32 rounded-full bg-slate-200" />
                  <div className="h-5 w-48 rounded-full bg-slate-200" />
                  <div className="h-4 w-full rounded-full bg-slate-100" />
                  <div className="h-4 w-5/6 rounded-full bg-slate-100" />
                </div>
                <p className="mt-5 text-sm text-slate-500">Loading discussions for {channelLabel.toLowerCase()}…</p>
              </div>
            ) : showEmptyView ? (
              <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-8 shadow-sm sm:p-10">
                <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">✦</div>
                  <p className="mt-4 text-xl font-semibold text-slate-900">{emptyStateTitle}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{emptyStateDescription}</p>
                  <button
                    type="button"
                    onClick={() => setShowNewDiscussion(true)}
                    className="mt-6 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Start the first discussion
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {currentDiscussions.map((discussion) => (
                  <div key={discussion.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {discussion.pinned && (
                            <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">PINNED</span>
                          )}
                        </div>
                        <h3 className="text-lg font-semibold">{discussion.title}</h3>
                        <p className="mt-1 text-sm text-slate-500">{discussion.user.name} • {new Date(discussion.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                    </div>

                    <div className="text-sm text-gray-700">
                      {expandedId === discussion.id ? (
                        <>
                          <p className="mb-4 whitespace-pre-wrap">{discussion.content}</p>

                          {discussion.replies.length > 0 && (
                            <div className="mt-6 pt-4 border-t space-y-3">
                              <p className="font-medium text-gray-600">{discussion.replies.length} replies</p>
                              {discussion.replies.map((reply) => (
                                <div key={reply.id} className="bg-gray-50 p-3 rounded">
                                  <div className="flex justify-between items-start gap-3">
                                    <p className="text-xs text-slate-500">{reply.user.name} • {new Date(reply.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                                    {(sessionUser?.id === reply.user.id || isAdmin) && (
                                      <button onClick={() => handleDeleteReply(reply.id)} className="text-xs text-red-600 hover:text-red-800">Delete</button>
                                    )}
                                  </div>
                                  <p className="text-sm mt-1">{reply.content}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {replyingTo === discussion.id ? (
                            <div className="mt-4 pt-4 border-t">
                              <textarea
                                value={replyContent}
                                onChange={(e) => setReplyContent(e.target.value)}
                                placeholder="Write a reply..."
                                className="w-full px-3 py-2 border rounded h-20 text-sm"
                              />
                              <div className="flex gap-2 mt-2">
                                <button
                                  type="button"
                                  onClick={() => handleAddReply(discussion.id)}
                                  disabled={createReplyMutation.isPending}
                                  className="rounded px-3 py-1 bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {createReplyMutation.isPending ? "Posting..." : "Reply"}
                                </button>
                                <button type="button" onClick={() => { setReplyingTo(null); setReplyContent(""); }} className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setReplyingTo(discussion.id)} className="text-blue-600 hover:text-blue-800 mt-4 text-sm">Reply</button>
                          )}

                          <button type="button" onClick={() => setExpandedId(null)} className="text-blue-600 hover:text-blue-800 mt-2 text-sm ml-4">Show less</button>
                        </>
                      ) : (
                        <>
                          <p className="line-clamp-2">{discussion.content}</p>
                          {discussion.replies.length > 0 && <p className="text-gray-500 mt-2">{discussion.replies.length} replies</p>}
                          <button type="button" onClick={() => setExpandedId(discussion.id)} className="text-blue-600 hover:text-blue-800 mt-2 text-sm">Show more</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

