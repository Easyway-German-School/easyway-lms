"use client";

import { useEffect, useState } from "react";

interface Notification {
  id: string;
  title: string;
  message: string;
  channel: string;
  status: string;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("notificationFilter") as "all" | "unread") || "all";
    }
    return "all";
  });

  useEffect(() => {
    loadNotifications();
  }, [filter]);

  useEffect(() => {
    localStorage.setItem("notificationFilter", filter);
  }, [filter]);

  const loadNotifications = async () => {
    setIsLoading(true);
    try {
      const unreadParam = filter === "unread" ? "&unread=true" : "";
      const response = await fetch(`/api/notifications?limit=100${unreadParam}`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications);
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationIds: string[]) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds }),
      });
      loadNotifications();
    } catch (error) {
      console.error("Failed to mark as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllAsRead: true }),
      });
      loadNotifications();
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

  const handleDelete = async (notificationId: string) => {
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      loadNotifications();
    } catch (error) {
      console.error("Failed to delete notification:", error);
    }
  };

  const getNotificationIcon = (title: string) => {
    if (title.includes("Payment")) return "💳";
    if (title.includes("Exam")) return "📝";
    if (title.includes("Graduation")) return "🎓";
    if (title.includes("Material")) return "📚";
    if (title.includes("Result")) return "📊";
    if (title.includes("Balance") || title.includes("Reminder")) return "⏰";
    return "🔔";
  };

  const getStatusColor = (notification: Notification) => {
    if (notification.status === "sent") return "text-green-600";
    if (notification.status === "pending") return "text-yellow-600";
    if (notification.status === "failed") return "text-red-600";
    return "text-gray-600";
  };

  return (
    <div className="min-h-screen bg-[var(--background)] p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Notifications</h1>
          {notifications.some((n) => !n.readAt) && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition text-sm"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg transition ${
              filter === "all"
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] border border-[var(--border)]"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`px-4 py-2 rounded-lg transition ${
              filter === "unread"
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] border border-[var(--border)]"
            }`}
          >
            Unread
          </button>
        </div>

        {/* Notifications List */}
        {isLoading ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-[var(--muted)]">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 rounded-lg border transition ${
                  !notification.readAt
                    ? "bg-[var(--accent)]/5 border-[var(--accent)]"
                    : "bg-[var(--surface)] border-[var(--border)]"
                }`}
              >
                <div className="flex gap-4">
                  <div className="text-3xl flex-shrink-0">
                    {getNotificationIcon(notification.title)}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-lg">{notification.title}</h3>
                      <span className={`text-xs ${getStatusColor(notification)}`}>
                        {notification.status}
                      </span>
                    </div>
                    <p className="text-[var(--muted)] mb-3">{notification.message}</p>
                    <div className="flex justify-between items-center text-sm text-[var(--muted)]">
                      <span>
                        {new Date(notification.createdAt).toLocaleDateString("en-US", {
                          weekday: "short",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <div className="flex gap-2">
                        {!notification.readAt && (
                          <button
                            onClick={() => handleMarkAsRead([notification.id])}
                            className="text-[var(--accent)] hover:underline"
                          >
                            Mark as read
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(notification.id)}
                          className="text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
