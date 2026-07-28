"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface EmailLog {
  id: string;
  type: string;
  subject: string;
  recipientEmail: string;
  status: string;
  sentAt: string;
  errorMessage?: string;
}

interface EmailStats {
  totalPartialInvoices: number;
  emailStats: Record<string, number>;
}

export default function AdminEmailManagementPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<"send" | "logs" | "settings">("send");
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);

  // Form states
  const [sendToStudentId, setSendToStudentId] = useState("");
  const [emailType, setEmailType] = useState<"welcome" | "exam-reminder" | "graduation" | "fee-reminders">("welcome");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    checkAdmin();
    loadStats();
  }, []);

  const checkAdmin = async () => {
    try {
      const response = await fetch("/api/admin/students");
      if (response.status === 401) {
        router.push("/auth/signin");
      } else {
        setIsAdmin(true);
      }
    } catch (error) {
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch("/api/emails/send/fee-reminders");
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
    }
  };

  const handleSendEmail = async () => {
    setIsSending(true);
    setMessage("");

    try {
      let endpoint = "";
      let body: Record<string, any> = {};

      switch (emailType) {
        case "welcome":
          endpoint = "/api/emails/send/welcome";
          body = { studentId: sendToStudentId };
          break;
        case "exam-reminder":
          endpoint = "/api/emails/send/exam-reminder";
          body = { studentId: sendToStudentId };
          break;
        case "graduation":
          endpoint = "/api/emails/send/graduation";
          body = {
            studentId: sendToStudentId,
            pathwayName: "Program",
          };
          break;
        case "fee-reminders":
          endpoint = "/api/emails/send/fee-reminders";
          body = { studentId: sendToStudentId || undefined, forceSend: true };
          break;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage(`✓ ${data.message || "Email sent successfully"}`);
        setSendToStudentId("");
      } else {
        setMessage(`✗ ${data.error || "Failed to send email"}`);
      }
    } catch (error) {
      setMessage(`✗ Error: ${error}`);
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!isAdmin) {
    return <div className="flex items-center justify-center min-h-screen">Unauthorized</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--background)] p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Email & Notification Management</h1>
          <p className="text-[var(--muted)]">
            Send emails, manage reminders, and view email logs
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-[var(--border)]">
          {["send", "logs", "settings"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              className={`px-4 py-3 font-semibold transition ${
                activeTab === tab
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {tab === "send" && "Send Email"}
              {tab === "logs" && "Email Logs"}
              {tab === "settings" && "Settings"}
            </button>
          ))}
        </div>

        {/* Send Email Tab */}
        {activeTab === "send" && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Send Email</h2>

            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-semibold mb-2">Email Type</label>
                <select
                  value={emailType}
                  onChange={(e) => setEmailType(e.target.value as any)}
                  className="w-full p-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                >
                  <option value="welcome">Welcome Email</option>
                  <option value="exam-reminder">Exam Reminder</option>
                  <option value="graduation">Graduation Email</option>
                  <option value="fee-reminders">Fee Reminders</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Student ID (optional)</label>
                <input
                  type="text"
                  value={sendToStudentId}
                  onChange={(e) => setSendToStudentId(e.target.value)}
                  placeholder="Leave empty to send to all eligible students"
                  className="w-full p-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
              </div>

              <button
                onClick={handleSendEmail}
                disabled={isSending || (["welcome", "exam-reminder", "graduation"].includes(emailType) && !sendToStudentId)}
                className="w-full py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition font-semibold"
              >
                {isSending ? "Sending..." : "Send Email"}
              </button>

              {message && (
                <div className={`p-3 rounded-lg text-sm ${message.startsWith("✓") ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {message}
                </div>
              )}
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <p className="font-semibold mb-2">📧 Email Types:</p>
              <ul className="space-y-1 text-xs">
                <li>• <strong>Welcome:</strong> Sent after successful payment</li>
                <li>• <strong>Exam Reminder:</strong> Sent before upcoming exams</li>
                <li>• <strong>Graduation:</strong> Sent when student completes program</li>
                <li>• <strong>Fee Reminders:</strong> Sent at 7, 14, and 30 days for partial payments</li>
              </ul>
            </div>
          </div>
        )}

        {/* Email Logs Tab */}
        {activeTab === "logs" && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Email Logs</h2>

            {stats && (
              <div className="mb-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 bg-[var(--background)] border border-[var(--border)] rounded-lg">
                  <p className="text-sm text-[var(--muted)]">Partial Invoices</p>
                  <p className="text-2xl font-bold">{stats.totalPartialInvoices}</p>
                </div>
                {Object.entries(stats.emailStats).map(([type, count]) => (
                  <div key={type} className="p-4 bg-[var(--background)] border border-[var(--border)] rounded-lg">
                    <p className="text-sm text-[var(--muted)] capitalize">{type.replace(/_/g, " ")}</p>
                    <p className="text-2xl font-bold">{count}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="text-center py-8 text-[var(--muted)]">
              <p>Detailed email logs can be viewed in the database.</p>
              <p className="text-sm mt-2">Logs are automatically created for each sent email.</p>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Email Settings</h2>

            <div className="space-y-6">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-semibold text-blue-900 mb-2">🔄 Automated Reminders</h3>
                <p className="text-sm text-blue-800 mb-3">
                  Fee reminders are automatically sent at 7, 14, and 30 days for students with partial payments.
                </p>
                <p className="text-xs text-blue-700">
                  <strong>Setup:</strong> Add this cron job to your server (daily):
                </p>
                <code className="block mt-2 p-2 bg-white border border-blue-300 rounded text-xs overflow-x-auto">
                  curl -H "Authorization: Bearer YOUR_CRON_SECRET" {process.env.NEXTAUTH_URL}/api/cron/fee-reminders
                </code>
              </div>

              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h3 className="font-semibold text-yellow-900 mb-2">⚙️ Configuration</h3>
                <p className="text-sm text-yellow-800">
                  Email service is configured using SMTP settings in your environment variables:
                </p>
                <ul className="text-xs text-yellow-700 mt-2 space-y-1">
                  <li>• SMTP_HOST</li>
                  <li>• SMTP_PORT</li>
                  <li>• SMTP_USER</li>
                  <li>• SMTP_PASS</li>
                  <li>• SMTP_FROM</li>
                </ul>
              </div>

              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="font-semibold text-green-900 mb-2">✓ Enable In-App Notifications</h3>
                <p className="text-sm text-green-800">
                  Notifications are enabled by default. Students can view all notifications in their notification center.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
