"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

interface Course {
  title: string;
}

interface User {
  id: string;
  name: string;
  email: string;
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

export default function AdminCommunityPage() {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadDiscussions();
  }, []);

  async function loadDiscussions() {
    try {
      const res = await fetch("/api/admin/community");
      if (!res.ok) throw new Error("Failed to fetch discussions");
      const data = await res.json();
      setDiscussions(data);
    } catch (err) {
      setError("Failed to load discussions");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePin(id: string, pinned: boolean) {
    try {
      const res = await fetch("/api/admin/community", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pinned: !pinned }),
      });

      if (!res.ok) throw new Error("Failed to update discussion");

      setError("");
      await loadDiscussions();
    } catch (err) {
      setError("Failed to update discussion");
      console.error(err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this discussion?")) return;

    try {
      const res = await fetch("/api/admin/community", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) throw new Error("Failed to delete discussion");

      setError("");
      await loadDiscussions();
    } catch (err) {
      setError("Failed to delete discussion");
      console.error(err);
    }
  }

  if (loading) {
    return (
      <AdminShell>
        <div className="p-8">Loading...</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-8">Community Discussions</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}

        {discussions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No discussions yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {discussions.map((discussion) => (
              <div
                key={discussion.id}
                className="bg-white rounded-lg border p-6"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {discussion.pinned && (
                        <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                          PINNED
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        {discussion.course.title}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold">{discussion.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      by {discussion.user.name} on{" "}
                      {new Date(discussion.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePin(discussion.id, discussion.pinned)}
                      className={`px-3 py-1 rounded text-sm font-medium ${
                        discussion.pinned
                          ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {discussion.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      onClick={() => handleDelete(discussion.id)}
                      className="px-3 py-1 rounded text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div
                  className="text-sm text-gray-700 cursor-pointer hover:text-blue-600"
                  onClick={() =>
                    setExpandedId(expandedId === discussion.id ? null : discussion.id)
                  }
                >
                  {expandedId === discussion.id ? (
                    <>
                      <p className="mb-3 whitespace-pre-wrap">{discussion.content}</p>
                      {discussion.replies.length > 0 && (
                        <div className="mt-4 pt-4 border-t space-y-3">
                          <p className="font-medium text-gray-600">
                            {discussion.replies.length} replies
                          </p>
                          {discussion.replies.map((reply) => (
                            <div key={reply.id} className="bg-gray-50 p-3 rounded">
                              <p className="text-xs text-gray-500">
                                {reply.user.name} -{" "}
                                {new Date(reply.createdAt).toLocaleDateString()}
                              </p>
                              <p className="text-sm mt-1">{reply.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <button className="text-blue-600 hover:text-blue-800 mt-2 text-sm">
                        Show less
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="line-clamp-2">{discussion.content}</p>
                      {discussion.replies.length > 0 && (
                        <p className="text-gray-500 mt-2">
                          {discussion.replies.length} replies
                        </p>
                      )}
                      <button className="text-blue-600 hover:text-blue-800 mt-2 text-sm">
                        Show more
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
