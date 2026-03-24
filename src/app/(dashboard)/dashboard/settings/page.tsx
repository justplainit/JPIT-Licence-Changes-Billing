"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

const roleLabels: Record<string, string> = {
  ADMIN: "Admin",
  BILLING_STAFF: "Billing Staff",
  READ_ONLY: "Read Only",
};

const roleBadgeStyles: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-700",
  BILLING_STAFF: "bg-blue-100 text-blue-700",
  READ_ONLY: "bg-gray-100 text-gray-600",
};

export default function SettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add user modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    password: "",
    userRole: "BILLING_STAFF",
  });

  // Edit user modal
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    password: "",
    userRole: "BILLING_STAFF",
  });

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const res = await fetch("/api/users");
      if (res.status === 403) {
        setIsAdmin(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch users");
      setIsAdmin(true);
      setUsers(await res.json());
    } catch {
      // Non-admin or error — just hide the section
      setIsAdmin(false);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }
      setSuccess("User created successfully. They can now sign in.");
      setTimeout(() => setSuccess(null), 5000);
      setShowAddModal(false);
      setAddForm({ name: "", email: "", password: "", userRole: "BILLING_STAFF" });
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  const startEditUser = (user: User) => {
    setEditingUser(user);
    setEditForm({
      name: user.name,
      email: user.email,
      password: "",
      userRole: user.role,
    });
    setError(null);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    if (!editingUser) return;
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        name: editForm.name,
        email: editForm.email,
        userRole: editForm.userRole,
      };
      if (editForm.password) {
        body.password = editForm.password;
      }

      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update user");
      }
      setSuccess("User updated successfully.");
      setTimeout(() => setSuccess(null), 5000);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }
      setSuccess("User deleted.");
      setTimeout(() => setSuccess(null), 5000);
      setDeletingId(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          System configuration and preferences.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>
      )}

      {/* User Management — ADMIN only */}
      {!loadingUsers && isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>
                Add team members so they can sign in. Each user gets a role that
                controls what they can do.
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddModal(true)}>Add User</Button>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">No users found.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Name
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Email
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Role
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Created
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          {user.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {user.email}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleBadgeStyles[user.role] || "bg-gray-100 text-gray-600"}`}
                          >
                            {roleLabels[user.role] || user.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {new Date(user.createdAt).toLocaleDateString("en-ZA")}
                        </td>
                        <td className="px-4 py-3 text-sm space-x-3">
                          <button
                            onClick={() => startEditUser(user)}
                            className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                          >
                            Edit
                          </button>
                          {deletingId === user.id ? (
                            <span className="inline-flex items-center gap-2">
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="text-red-600 hover:text-red-800 font-medium text-xs"
                              >
                                Confirm Delete
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="text-slate-500 hover:text-slate-700 font-medium text-xs"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeletingId(user.id)}
                              className="text-red-500 hover:text-red-700 font-medium text-xs"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 rounded-md bg-blue-50 p-3 text-xs text-blue-700">
              <strong>Roles:</strong>{" "}
              <strong>Admin</strong> — full access, can manage users.{" "}
              <strong>Billing Staff</strong> — can view, create, and edit everything except user management.{" "}
              <strong>Read Only</strong> — can only view data, cannot make any changes.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Billing Configuration</CardTitle>
            <CardDescription>Default billing settings for the system.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Default Currency</span>
              <span className="font-medium">ZAR</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Billing Day</span>
              <span className="font-medium">26th of each month</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">FX Source Currency</span>
              <span className="font-medium">USD</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">7-Day Window Duration</span>
              <span className="font-medium">7 calendar days</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>NCE Policy Settings</CardTitle>
            <CardDescription>Microsoft NCE programme rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Mid-term seat additions</span>
              <span className="font-medium text-green-600">Allowed (pro-rated)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Mid-term seat removals</span>
              <span className="font-medium text-red-600">Only at renewal</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Cancellation window</span>
              <span className="font-medium">7 days from change</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Upgrade mid-term</span>
              <span className="font-medium text-green-600">Allowed</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Downgrade mid-term</span>
              <span className="font-medium text-red-600">Only at renewal</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>System Information</CardTitle>
            <CardDescription>Application details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Application</span>
              <span className="font-medium">M365 NCE Billing Management</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Version</span>
              <span className="font-medium">0.1.0</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Framework</span>
              <span className="font-medium">Next.js 16</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add User</h2>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-2">
                <Label>Name <span className="text-red-500">*</span></Label>
                <Input
                  value={addForm.name}
                  onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Full name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Email <span className="text-red-500">*</span></Label>
                <Input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="user@company.co.za"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Password <span className="text-red-500">*</span></Label>
                <Input
                  type="password"
                  value={addForm.password}
                  onChange={(e) => setAddForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <select
                  value={addForm.userRole}
                  onChange={(e) => setAddForm((p) => ({ ...p, userRole: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="BILLING_STAFF">Billing Staff</option>
                  <option value="READ_ONLY">Read Only</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create User"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Edit User: {editingUser.name}
            </h2>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Leave blank to keep current password"
                  minLength={8}
                />
                <p className="text-xs text-slate-400">
                  Only fill this in if you want to reset their password.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <select
                  value={editForm.userRole}
                  onChange={(e) => setEditForm((p) => ({ ...p, userRole: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="BILLING_STAFF">Billing Staff</option>
                  <option value="READ_ONLY">Read Only</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
