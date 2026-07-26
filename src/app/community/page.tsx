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
  locked?: boolean;
  resolved?: boolean;
}

interface CommunityNotification {
  id: string;
  title: string;
  body: string;
  kind: "discussion" | "reply" | "mention" | "room";
  unread: boolean;
  createdAt: string;
}

interface LiveRoomMessage {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

interface LiveRoom {
  id: string;
  name: string;
  topic: string;
  participants: number;
  status: string;
  messages: LiveRoomMessage[];
}

interface DirectNote {
  id: string;
  recipient: string;
  message: string;
  createdAt: string;
}

interface TutorMessage {
  id: string;
  author: string;
  role: string;
  body: string;
  channel: string;
  createdAt: string;
}

interface ToastMessage {
  id: string;
  title: string;
  body: string;
  kind: CommunityNotification["kind"];
}

function readStoredState<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredState<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function extractMentions(text: string) {
  const matches = text.match(/@([A-Za-z0-9._-]+)/g) || [];
  return matches.map((match) => match.replace("@", ""));
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
  const isTutor = isAdmin || sessionUser?.role?.toLowerCase() === "lecturer";
  const [selectedCourseId, setSelectedCourseId] = useState<string | null | undefined>(undefined);
  const [discussionCourseId, setDiscussionCourseId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [newDiscussion, setNewDiscussion] = useState({ title: "", content: "" });
  const [showNewDiscussion, setShowNewDiscussion] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [notifications, setNotifications] = useState<CommunityNotification[]>(() => readStoredState("easyway-community-notifications", []));
  const [toastQueue, setToastQueue] = useState<ToastMessage[]>([]);
  const [reactions, setReactions] = useState<Record<string, { upvotes: number; downvotes: number; userVote: "up" | "down" | null }>>(() => readStoredState("easyway-community-reactions", {}));
  const [rooms, setRooms] = useState<LiveRoom[]>(() => readStoredState("easyway-community-rooms", [
    { id: "office-hours", name: "Office hours", topic: "Live Q&A with lecturers", participants: 18, status: "Live now", messages: [{ id: "m1", author: "Amina", text: "Welcome! Drop your questions in the room.", createdAt: new Date().toISOString() }] },
    { id: "study-circle", name: "Study circle", topic: "Vocabulary sprint", participants: 12, status: "Starting soon", messages: [{ id: "m2", author: "Luca", text: "I’m sharing a quick pronunciation drill.", createdAt: new Date().toISOString() }] },
    { id: "career-club", name: "Career club", topic: "German work readiness", participants: 9, status: "Live now", messages: [{ id: "m3", author: "Mina", text: "We’re talking about interview prep today.", createdAt: new Date().toISOString() }] },
  ]));
  const [activeRoomId, setActiveRoomId] = useState("office-hours");
  const [roomMessage, setRoomMessage] = useState("");
  const [directMessage, setDirectMessage] = useState({ recipient: "Lecturer", text: "" });
  const [directNotes, setDirectNotes] = useState<DirectNote[]>(() => readStoredState("easyway-community-notes", []));
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>(() => readStoredState("easyway-community-tutor-messages", [
    { id: "tutor-1", author: "Coach Amina", role: "Lecturer", body: "Reminder: join the live office hours at 6pm for pronunciation practice.", channel: "All spaces", createdAt: new Date().toISOString() },
  ]));
  const [tutorDraft, setTutorDraft] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    writeStoredState("easyway-community-notifications", notifications);
  }, [notifications]);

  useEffect(() => {
    writeStoredState("easyway-community-reactions", reactions);
  }, [reactions]);

  useEffect(() => {
    writeStoredState("easyway-community-rooms", rooms);
  }, [rooms]);

  useEffect(() => {
    writeStoredState("easyway-community-notes", directNotes);
  }, [directNotes]);

  useEffect(() => {
    writeStoredState("easyway-community-tutor-messages", tutorMessages);
  }, [tutorMessages]);

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
    onSuccess: (createdDiscussion) => {
      setFeedback({ type: "success", text: "Discussion posted to the community." });
      addNotification("New discussion", `Your thread “${createdDiscussion.title}” is live.`, "discussion");
      pushToast("New discussion", `Your thread “${createdDiscussion.title}” is live.`, "discussion");
      const mentions = extractMentions(createdDiscussion.content);
      if (mentions.length > 0) {
        addNotification("Mentioned learners", `You tagged ${mentions.join(", ")}.`, "mention");
        pushToast("Mentioned learners", `You tagged ${mentions.join(", ")}.`, "mention");
      }
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
      addNotification("Reply posted", "Your message is now part of the thread.", "reply");
      pushToast("Reply posted", "Your message is now part of the thread.", "reply");
      const mentions = extractMentions(replyContent);
      if (mentions.length > 0) {
        addNotification("Mentioned learners", `You tagged ${mentions.join(", ")}.`, "mention");
        pushToast("Mentioned learners", `You tagged ${mentions.join(", ")}.`, "mention");
      }
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
  const unreadCount = notifications.filter((item) => item.unread).length;
  const mentionCount = notifications.filter((item) => item.kind === "mention").length;
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0];

  function addNotification(title: string, body: string, kind: CommunityNotification["kind"]) {
    setNotifications((current) => [{
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      body,
      kind,
      unread: true,
      createdAt: new Date().toISOString(),
    }, ...current].slice(0, 8));
  }

  function pushToast(title: string, body: string, kind: CommunityNotification["kind"]) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToastQueue((current) => [{ id, title, body, kind }, ...current].slice(0, 3));
    window.setTimeout(() => {
      setToastQueue((current) => current.filter((item) => item.id !== id));
    }, 3500);
  }

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

  function updateDiscussionInCache(discussionId: string, updater: (discussion: Discussion) => Discussion) {
    queryClient.setQueryData<Discussion[]>(["communityDiscussions", selectedKey], (previous) =>
      previous?.map((discussion) => (discussion.id === discussionId ? updater(discussion) : discussion)) ?? previous
    );
  }

  function handleTogglePinned(discussion: Discussion) {
    const nextPinned = !discussion.pinned;
    updateDiscussionInCache(discussion.id, (item) => ({ ...item, pinned: nextPinned }));
    addNotification(nextPinned ? "Thread pinned" : "Thread unpinned", `${discussion.title} is now ${nextPinned ? "pinned" : "unpinned"}.`, "discussion");
    pushToast(nextPinned ? "Thread pinned" : "Thread unpinned", `${discussion.title} is now ${nextPinned ? "pinned" : "unpinned"}.`, "discussion");
    setFeedback({ type: "success", text: nextPinned ? "Thread pinned for the community." : "Thread unpinned." });
  }

  function handleResolveDiscussion(discussion: Discussion) {
    const nextResolved = !discussion.resolved;
    updateDiscussionInCache(discussion.id, (item) => ({ ...item, resolved: nextResolved, locked: nextResolved ? true : item.locked }));
    addNotification(nextResolved ? "Thread resolved" : "Thread reopened", `${discussion.title} is now ${nextResolved ? "resolved" : "reopened"}.`, "discussion");
    pushToast(nextResolved ? "Thread resolved" : "Thread reopened", `${discussion.title} is now ${nextResolved ? "resolved" : "reopened"}.`, "discussion");
    setFeedback({ type: "success", text: nextResolved ? "Discussion marked as resolved." : "Discussion reopened." });
  }

  function handleDeleteDiscussion(discussionId: string, title: string) {
    if (!confirm("Remove this discussion from the community board?")) return;
    queryClient.setQueryData<Discussion[]>(["communityDiscussions", selectedKey], (previous) => previous?.filter((discussion) => discussion.id !== discussionId) ?? previous);
    addNotification("Thread removed", `${title} was removed from the board.`, "discussion");
    pushToast("Thread removed", `${title} was removed from the board.`, "discussion");
    setFeedback({ type: "success", text: "Discussion removed from the board." });
  }

  function handleReaction(discussionId: string, vote: "up" | "down") {
    setReactions((current) => {
      const existing = current[discussionId] ?? { upvotes: 0, downvotes: 0, userVote: null };
      const nextVote = existing.userVote === vote ? null : vote;
      let nextUpvotes = existing.upvotes;
      let nextDownvotes = existing.downvotes;

      if (existing.userVote === "up") {
        nextUpvotes = Math.max(0, nextUpvotes - 1);
      }
      if (existing.userVote === "down") {
        nextDownvotes = Math.max(0, nextDownvotes - 1);
      }
      if (nextVote === "up") {
        nextUpvotes += 1;
      }
      if (nextVote === "down") {
        nextDownvotes += 1;
      }

      return {
        ...current,
        [discussionId]: { upvotes: nextUpvotes, downvotes: nextDownvotes, userVote: nextVote },
      };
    });
  }

  function handleSendRoomMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!roomMessage.trim() || !activeRoom) return;

    setRooms((current) => current.map((room) => room.id === activeRoom.id ? {
      ...room,
      messages: [
        ...room.messages,
        { id: `${Date.now()}`, author: sessionUser?.name || "You", text: roomMessage.trim(), createdAt: new Date().toISOString() },
      ],
    } : room));
    addNotification("Live room activity", `You sent a message in ${activeRoom.name}.`, "room");
    pushToast("Live room activity", `You sent a message in ${activeRoom.name}.`, "room");
    setRoomMessage("");
  }

  function handleSendDirectNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!directMessage.text.trim()) return;
    const note: DirectNote = {
      id: `${Date.now()}`,
      recipient: directMessage.recipient,
      message: directMessage.text.trim(),
      createdAt: new Date().toISOString(),
    };
    setDirectNotes((current) => [note, ...current].slice(0, 4));
    addNotification("Direct note sent", `Your note reached ${note.recipient}.`, "mention");
    pushToast("Direct note sent", `Your note reached ${note.recipient}.`, "mention");
    setDirectMessage({ ...directMessage, text: "" });
  }

  function handleTutorBroadcast(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tutorDraft.trim() || !isTutor) return;

    const message: TutorMessage = {
      id: `${Date.now()}`,
      author: sessionUser?.name || "Tutor",
      role: sessionUser?.role ? sessionUser.role.toUpperCase() : "LECTURER",
      body: tutorDraft.trim(),
      channel: channelLabel,
      createdAt: new Date().toISOString(),
    };

    setTutorMessages((current) => [message, ...current].slice(0, 8));
    addNotification("Tutor broadcast", `Your message is live for ${channelLabel}.`, "room");
    pushToast("Tutor broadcast", `Your message is live for ${channelLabel}.`, "room");
    setTutorDraft("");
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
    <div className="min-h-screen bg-[#07111f] p-6 text-slate-100 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[32px] border border-emerald-500/20 bg-gradient-to-br from-[#0f172a] via-[#0b1220] to-[#07111f] p-7 shadow-2xl shadow-emerald-950/40 sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">Easyway social hub</p>
              <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Your learning spaces</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                WhatsApp-style conversations, instant tutor updates, and a community feel that is fast, social, and easier to use than a regular group chat.
              </p>
            </div>
            <button type="button" onClick={() => setNotificationsOpen((current) => !current)} className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300">
              {notificationsOpen ? "Hide alerts" : `Alerts ${unreadCount}`}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {feedback && (
          <div className={`mb-4 mt-4 rounded-2xl border p-4 text-sm ${feedback.type === "success" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}>
            {feedback.text}
          </div>
        )}

        {toastQueue.length > 0 && (
          <div className="fixed right-4 top-4 z-50 flex max-w-sm flex-col gap-2">
            {toastQueue.map((toast) => (
              <div key={toast.id} className="rounded-2xl border border-emerald-400/20 bg-slate-900/95 p-3 shadow-lg shadow-black/20">
                <p className="text-sm font-semibold text-emerald-300">{toast.title}</p>
                <p className="mt-1 text-sm text-slate-300">{toast.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/10">
            <p className="text-sm font-semibold text-emerald-400">Live rooms</p>
            <p className="mt-2 text-2xl font-semibold text-white">{rooms.length}</p>
            <p className="text-sm text-slate-400">Open rooms for study circles and office hours.</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/10">
            <p className="text-sm font-semibold text-emerald-400">Unread activity</p>
            <p className="mt-2 text-2xl font-semibold text-white">{unreadCount}</p>
            <p className="text-sm text-slate-400">Community updates and replies waiting for you.</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/10">
            <p className="text-sm font-semibold text-emerald-400">Mentions</p>
            <p className="mt-2 text-2xl font-semibold text-white">{mentionCount}</p>
            <p className="text-sm text-slate-400">Direct notes and tagged conversations.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="h-fit rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/10">
            <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Channels</p>
            <div className="mt-3 space-y-1">
              <button type="button" onClick={() => handleSelectChannel(null)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold ${selectedCourseId === null ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300 hover:bg-slate-800/70"}`}>
                <span className="text-lg">#</span> All spaces
              </button>
              {courses.map((course) => (
                <button key={course.id} type="button" onClick={() => handleSelectChannel(course.id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm ${selectedCourseId === course.id ? "bg-emerald-500/15 font-semibold text-emerald-300" : "text-slate-300 hover:bg-slate-800/70"}`}>
                  <span className="text-lg">#</span>
                  <span className="min-w-0 truncate">{course.level || course.title}</span>
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Live alerts</p>
                <button type="button" onClick={() => setNotificationsOpen((current) => !current)} className="text-xs font-semibold text-emerald-300">{notificationsOpen ? "Hide" : "Show"}</button>
              </div>
              {notificationsOpen && (
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  {notifications.slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-2">
                      <p className="font-semibold text-white">{item.title}</p>
                      <p className="text-xs text-slate-400">{item.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">{channelLabel}</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">Discussion channels</h2>
                </div>
                <button type="button" onClick={() => setShowNewDiscussion((current) => !current)} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
                  {showNewDiscussion ? "Close composer" : "Start discussion"}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                <span className="rounded-full bg-slate-800 px-3 py-1">{discussionCount} discussions</span>
                {pinnedCount > 0 && <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-300">{pinnedCount} pinned</span>}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div>
                {showNewDiscussion && (
                  <div className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-black/10">
                    <h2 className="mb-4 text-xl font-semibold text-white">Create Discussion</h2>
                    <form onSubmit={handleCreateDiscussion} className="space-y-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Community *</label>
                        <select
                          value={discussionCourseId}
                          onChange={(e) => setDiscussionCourseId(e.target.value)}
                          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
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
                        <label className="mb-1 block text-sm font-medium text-slate-300">Title *</label>
                        <input
                          type="text"
                          value={newDiscussion.title}
                          onChange={(e) => setNewDiscussion({ ...newDiscussion, title: e.target.value })}
                          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                          required
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-300">Discussion *</label>
                        <textarea
                          value={newDiscussion.content}
                          onChange={(e) => setNewDiscussion({ ...newDiscussion, content: e.target.value })}
                          className="h-32 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                          required
                        />
                        <p className="mt-2 text-xs text-slate-500">Use @name to tag people and make them part of the conversation.</p>
                      </div>
                      <button type="submit" disabled={createDiscussionMutation.isPending} className="rounded-2xl bg-emerald-500 px-4 py-2 text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
                        {createDiscussionMutation.isPending ? "Posting..." : "Post Discussion"}
                      </button>
                    </form>
                  </div>
                )}

                {isDiscussionBusy && currentDiscussions.length === 0 ? (
                  <div className="rounded-[28px] border border-slate-800 bg-slate-900/80 p-8 shadow-lg shadow-black/10 sm:p-10">
                    <div className="animate-pulse space-y-4">
                      <div className="h-4 w-32 rounded-full bg-slate-700" />
                      <div className="h-5 w-48 rounded-full bg-slate-700" />
                      <div className="h-4 w-full rounded-full bg-slate-800" />
                      <div className="h-4 w-5/6 rounded-full bg-slate-800" />
                    </div>
                    <p className="mt-5 text-sm text-slate-400">Loading discussions for {channelLabel.toLowerCase()}…</p>
                  </div>
                ) : showEmptyView ? (
                  <div className="rounded-[28px] border border-dashed border-slate-700 bg-slate-900/70 p-8 shadow-lg shadow-black/10 sm:p-10">
                    <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-xl text-emerald-400">✦</div>
                      <p className="mt-4 text-xl font-semibold text-white">{emptyStateTitle}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{emptyStateDescription}</p>
                      <button type="button" onClick={() => setShowNewDiscussion(true)} className="mt-6 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">Start the first discussion</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {currentDiscussions.map((discussion) => {
                      const discussionReactions = reactions[discussion.id] ?? { upvotes: 0, downvotes: 0, userVote: null };
                      const mentionTags = extractMentions(`${discussion.title} ${discussion.content}`);
                      return (
                        <div key={discussion.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-black/10">
                          <div className="mb-3 flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                {discussion.pinned && <span className="rounded bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-300">PINNED</span>}
                                {discussion.resolved && <span className="rounded bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300">RESOLVED</span>}
                                {discussion.locked && <span className="rounded bg-slate-700 px-2 py-1 text-xs font-medium text-slate-300">LOCKED</span>}
                                {mentionTags.length > 0 && <span className="rounded bg-sky-500/15 px-2 py-1 text-xs font-medium text-sky-300">@mention</span>}
                              </div>
                              <h3 className="text-lg font-semibold text-white">{discussion.title}</h3>
                              <p className="mt-1 text-sm text-slate-400">{discussion.user.name} • {new Date(discussion.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                            </div>
                            <div className="flex gap-2">
                              {(sessionUser?.id === discussion.user.id || isAdmin) && (
                                <>
                                  <button type="button" onClick={() => handleTogglePinned(discussion)} className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">{discussion.pinned ? "Unpin" : "Pin"}</button>
                                  <button type="button" onClick={() => handleResolveDiscussion(discussion)} className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">{discussion.resolved ? "Reopen" : "Resolve"}</button>
                                  <button type="button" onClick={() => handleDeleteDiscussion(discussion.id, discussion.title)} className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300">Remove</button>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="text-sm text-slate-300">
                            {expandedId === discussion.id ? (
                              <>
                                <p className="mb-4 whitespace-pre-wrap">{discussion.content}</p>

                                <div className="mb-4 flex items-center gap-2">
                                  <button type="button" onClick={() => handleReaction(discussion.id, "up")} className={`rounded-full px-3 py-1 text-sm ${discussionReactions.userVote === "up" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-300"}`}>▲ {discussionReactions.upvotes}</button>
                                  <button type="button" onClick={() => handleReaction(discussion.id, "down")} className={`rounded-full px-3 py-1 text-sm ${discussionReactions.userVote === "down" ? "bg-rose-500/15 text-rose-300" : "bg-slate-800 text-slate-300"}`}>▼ {discussionReactions.downvotes}</button>
                                </div>

                                {discussion.replies.length > 0 && (
                                  <div className="mt-6 space-y-3 border-t border-slate-800 pt-4">
                                    <p className="font-medium text-slate-400">{discussion.replies.length} replies</p>
                                    {discussion.replies.map((reply) => (
                                      <div key={reply.id} className="rounded bg-slate-950/80 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                          <p className="text-xs text-slate-400">{reply.user.name} • {new Date(reply.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                                          {(sessionUser?.id === reply.user.id || isAdmin) && (
                                            <button onClick={() => handleDeleteReply(reply.id)} className="text-xs text-red-300 hover:text-red-200">Delete</button>
                                          )}
                                        </div>
                                        <p className="mt-1 text-sm text-slate-300">{reply.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {replyingTo === discussion.id ? (
                                  <div className="mt-4 border-t border-slate-800 pt-4">
                                    <textarea value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder="Write a reply..." className="h-20 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                                    <div className="mt-2 flex gap-2">
                                      <button type="button" onClick={() => handleAddReply(discussion.id)} disabled={createReplyMutation.isPending} className="rounded bg-emerald-500 px-3 py-1 text-sm text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">{createReplyMutation.isPending ? "Posting..." : "Reply"}</button>
                                      <button type="button" onClick={() => { setReplyingTo(null); setReplyContent(""); }} className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => setReplyingTo(discussion.id)} className="mt-4 text-sm text-emerald-300 hover:text-emerald-200">Reply</button>
                                )}

                                <button type="button" onClick={() => setExpandedId(null)} className="ml-4 mt-2 text-sm text-emerald-300 hover:text-emerald-200">Show less</button>
                              </>
                            ) : (
                              <>
                                <p className="line-clamp-2">{discussion.content}</p>
                                {discussion.replies.length > 0 && <p className="mt-2 text-slate-400">{discussion.replies.length} replies</p>}
                                <button type="button" onClick={() => setExpandedId(discussion.id)} className="mt-2 text-sm text-emerald-300 hover:text-emerald-200">Show more</button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">Live rooms</p>
                      <h3 className="mt-1 text-xl font-semibold text-white">Community stage</h3>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {rooms.map((room) => (
                      <button key={room.id} type="button" onClick={() => setActiveRoomId(room.id)} className={`rounded-full px-3 py-1 text-sm ${activeRoomId === room.id ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-300"}`}>{room.name}</button>
                    ))}
                  </div>
                  {activeRoom && (
                    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-white">{activeRoom.name}</p>
                          <p className="text-sm text-slate-400">{activeRoom.topic}</p>
                        </div>
                        <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300">{activeRoom.status}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {activeRoom.messages.slice(-3).map((message) => (
                          <div key={message.id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-2 text-sm text-slate-300">
                            <p className="font-semibold text-white">{message.author}</p>
                            <p>{message.text}</p>
                          </div>
                        ))}
                      </div>
                      <form onSubmit={handleSendRoomMessage} className="mt-3 flex gap-2">
                        <input value={roomMessage} onChange={(e) => setRoomMessage(e.target.value)} className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="Drop a quick message" />
                        <button type="submit" className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white">Send</button>
                      </form>
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">Tutor broadcast</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">Push updates to the group</h3>
                  {isTutor && (
                    <form onSubmit={handleTutorBroadcast} className="mt-4 space-y-3">
                      <textarea value={tutorDraft} onChange={(e) => setTutorDraft(e.target.value)} className="h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="Share a reminder, update, or encouragement with learners..." />
                      <button type="submit" className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">Send broadcast</button>
                    </form>
                  )}
                  {!isTutor && <p className="mt-3 text-sm text-slate-400">Tutor and admin accounts can push updates here.</p>}
                  <div className="mt-4 space-y-2">
                    {tutorMessages.map((message) => (
                      <div key={message.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-white">{message.author}</p>
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-emerald-300">{message.role}</span>
                        </div>
                        <p className="mt-2">{message.body}</p>
                        <p className="mt-2 text-xs text-slate-500">{message.channel}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">Direct notes</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">DM-style check-ins</h3>
                  <form onSubmit={handleSendDirectNote} className="mt-4 space-y-3">
                    <select value={directMessage.recipient} onChange={(e) => setDirectMessage({ ...directMessage, recipient: e.target.value })} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
                      <option value="Lecturer">Lecturer</option>
                      <option value="Support">Support</option>
                      <option value="Peer">Peer</option>
                    </select>
                    <textarea value={directMessage.text} onChange={(e) => setDirectMessage({ ...directMessage, text: e.target.value })} className="h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="Share a quick note or request." />
                    <button type="submit" className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">Send note</button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {directNotes.map((note) => (
                      <div key={note.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                        <p className="font-semibold text-white">{note.recipient}</p>
                        <p>{note.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

