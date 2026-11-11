import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Award,
  Calendar,
  CheckCircle2,
  Copy,
  Edit,
  ExternalLink,
  KeyRound,
  Lock,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import type { Technician } from '../lib/types'
import { Button, Dialog, Field, Input, LoadingState } from '../components/ui'
import { AvatarUpload } from '../components/AvatarUpload'

export default function OwnerTechnicianAccounts() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTech, setEditingTech] = useState<Technician | null>(null)
  const [tempPasswordModal, setTempPasswordModal] = useState<{
    open: boolean
    techName: string
    userId: string
    password: string
  }>({ open: false, techName: '', userId: '', password: '' })
  const [copied, setCopied] = useState(false)

  // Fetch Technicians
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['owner-technicians'],
    queryFn: () => api.get<{ items: Technician[] }>('/technicians'),
  })

  const technicians = data?.items ?? []

  // Add Technician Form State
  const [addForm, setAddForm] = useState({
    name: '',
    userId: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    designation: '',
    specialization: '',
    incentiveRate: 10,
    accountStatus: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    joiningDate: new Date().toISOString().split('T')[0],
    profileImageUrl: null as string | null,
  })
  const [addError, setAddError] = useState<string | null>(null)

  // Edit Technician Form State
  const [editForm, setEditForm] = useState({
    name: '',
    userId: '',
    email: '',
    phone: '',
    password: '',
    designation: '',
    specialization: '',
    incentiveRate: 10,
    accountStatus: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    joiningDate: '',
    profileImageUrl: null as string | null,
  })
  const [editError, setEditError] = useState<string | null>(null)

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: typeof addForm) => {
      return api.post<{ technician: Technician }>('/technicians', payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['owner-technicians'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
      setShowAddModal(false)
      // Show created credentials to owner
      setTempPasswordModal({
        open: true,
        techName: res.technician.name,
        userId: res.technician.userId,
        password: addForm.password,
      })
      // Reset form
      setAddForm({
        name: '',
        userId: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
        designation: '',
        specialization: '',
        incentiveRate: 10,
        accountStatus: 'ACTIVE',
        joiningDate: new Date().toISOString().split('T')[0],
        profileImageUrl: null,
      })
    },
    onError: (err) => {
      setAddError(errorMessage(err))
    },
  })

  // Edit Mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof editForm> }) => {
      return api.patch<{ technician: Technician }>(`/technicians/${id}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-technicians'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
      setEditingTech(null)
    },
    onError: (err) => {
      setEditError(errorMessage(err))
    },
  })

  // Direct Reset Password Mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (techId: string) => {
      return api.post<{ ok: boolean; temporaryPassword: string; message: string }>(
        `/technicians/${techId}/reset-password`,
        {},
      )
    },
    onSuccess: (res, techId) => {
      queryClient.invalidateQueries({ queryKey: ['owner-technicians'] })
      const tech = technicians.find((t) => t.id === techId)
      if (tech) {
        setTempPasswordModal({
          open: true,
          techName: tech.name,
          userId: tech.userId,
          password: res.temporaryPassword,
        })
      }
    },
  })

  // Toggle Status Mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: 'ACTIVE' | 'INACTIVE' }) => {
      return api.patch<{ technician: Technician }>(`/technicians/${id}`, {
        accountStatus: newStatus,
        active: newStatus === 'ACTIVE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-technicians'] })
      queryClient.invalidateQueries({ queryKey: ['technicians'] })
    },
  })

  // Open Edit Modal
  const openEdit = (tech: Technician) => {
    setEditingTech(tech)
    setEditError(null)
    setEditForm({
      name: tech.name,
      userId: tech.userId,
      email: tech.email,
      phone: tech.phone || '',
      password: '',
      designation: tech.designation || '',
      specialization: tech.specialization || '',
      incentiveRate: tech.incentiveRate,
      accountStatus: (tech.accountStatus as 'ACTIVE' | 'INACTIVE') || (tech.active ? 'ACTIVE' : 'INACTIVE'),
      joiningDate: tech.joiningDate ? new Date(tech.joiningDate).toISOString().split('T')[0] : '',
      profileImageUrl: tech.profileImageUrl || null,
    })
  }

  // Auto-generate next user ID
  const handleOpenAdd = () => {
    const nextNum = technicians.length + 1
    const suggestedId = `TECH${nextNum < 10 ? `0${nextNum}` : nextNum}`
    setAddForm((prev) => ({
      ...prev,
      userId: suggestedId,
      password: `Fixit@${Math.floor(100000 + Math.random() * 900000)}`,
      confirmPassword: '',
    }))
    setAddError(null)
    setShowAddModal(true)
  }

  // Handle Add Submit
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    if (addForm.password !== addForm.confirmPassword) {
      setAddError('Initial password and confirmation password do not match.')
      return
    }
    if (addForm.password.length < 8) {
      setAddError('Password must be at least 8 characters long.')
      return
    }
    createMutation.mutate(addForm)
  }

  // Handle Edit Submit
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTech) return
    setEditError(null)
    const payload: Partial<typeof editForm> & { active?: boolean } = {
      name: editForm.name,
      userId: editForm.userId,
      email: editForm.email,
      phone: editForm.phone,
      designation: editForm.designation,
      specialization: editForm.specialization,
      incentiveRate: editForm.incentiveRate,
      accountStatus: editForm.accountStatus,
      active: editForm.accountStatus === 'ACTIVE',
      joiningDate: editForm.joiningDate,
      profileImageUrl: editForm.profileImageUrl,
    }
    if (editForm.password.trim()) {
      if (editForm.password.length < 8) {
        setEditError('Password must be at least 8 characters long.')
        return
      }
      payload.password = editForm.password
    }
    updateMutation.mutate({ id: editingTech.id, data: payload })
  }

  // Filtered List
  const filteredTechs = useMemo(() => {
    return technicians.filter((tech) => {
      const q = search.toLowerCase()
      const matchesSearch =
        tech.name.toLowerCase().includes(q) ||
        tech.email.toLowerCase().includes(q) ||
        tech.userId.toLowerCase().includes(q) ||
        (tech.phone && tech.phone.includes(q)) ||
        (tech.designation && tech.designation.toLowerCase().includes(q))

      const status = tech.accountStatus || (tech.active ? 'ACTIVE' : 'INACTIVE')
      const matchesStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'ACTIVE'
          ? status === 'ACTIVE'
          : status !== 'ACTIVE'

      return matchesSearch && matchesStatus
    })
  }, [technicians, search, statusFilter])

  const copyCredentials = () => {
    const text = `FIXIT AI Technician Credentials:\nUser ID: ${tempPasswordModal.userId}\nPassword: ${tempPasswordModal.password}\nLogin Portal: ${window.location.origin}/login?role=technician`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Shield className="h-4 w-4" />
            </span>
            <h1 className="break-words text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
              Technician Account Management
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Create, configure, and monitor technician login credentials, account statuses, and permissions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link to="/owner/password-requests">
            <Button variant="outline" size="sm" className="text-xs">
              <KeyRound className="h-3.5 w-3.5 mr-1.5 text-indigo-500" />
              Password Reset Requests
            </Button>
          </Link>
          <Button size="sm" onClick={handleOpenAdd} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add New Technician
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="surface p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, User ID, or email..."
            className="pl-12 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status:</span>
          <div className="flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl gap-1 text-xs">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  statusFilter === s
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} title="Refresh list">
            <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
          </Button>
        </div>
      </div>

      {/* Technicians List Table */}
      {isLoading ? (
        <div className="surface p-12">
          <LoadingState label="Loading technician accounts..." />
        </div>
      ) : error ? (
        <div className="surface p-6 text-center text-xs text-rose-600">
          Failed to load technician accounts: {errorMessage(error)}
        </div>
      ) : filteredTechs.length === 0 ? (
        <div className="surface p-12 text-center space-y-3">
          <Users className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">No Technicians Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {search ? 'No technician accounts match your search query.' : 'No technician accounts have been registered yet.'}
          </p>
          <Button size="sm" onClick={handleOpenAdd}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Technician
          </Button>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 dark:bg-white/[0.02] border-b border-slate-200/80 dark:border-white/10 uppercase tracking-wider text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4">Technician</th>
                  <th className="py-3 px-4">User ID</th>
                  <th className="py-3 px-4">Contact Info</th>
                  <th className="py-3 px-4">Designation &amp; Skills</th>
                  <th className="py-3 px-4">Joining Date</th>
                  <th className="py-3 px-4">Incentive</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-white/5">
                {filteredTechs.map((tech) => {
                  const status = tech.accountStatus || (tech.active ? 'ACTIVE' : 'INACTIVE')
                  const isActive = status === 'ACTIVE'
                  const initials = tech.name
                    .split(' ')
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((p) => p[0].toUpperCase())
                    .join('')

                  return (
                    <tr
                      key={tech.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition"
                    >
                      {/* Avatar & Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                            {tech.profileImageUrl ? (
                              <img
                                src={tech.profileImageUrl}
                                alt={tech.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400">
                                {initials}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">
                              {tech.name}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              Joined {tech.joiningDate ? new Date(tech.joiningDate).toLocaleDateString() : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* User ID */}
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-white/10">
                          {tech.userId}
                        </span>
                      </td>

                      {/* Contact Info */}
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <p className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                            <Mail className="h-3 w-3 text-slate-400" />
                            {tech.email}
                          </p>
                          {tech.phone && (
                            <p className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                              <Phone className="h-3 w-3 text-slate-400" />
                              {tech.phone}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Designation */}
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-slate-800 dark:text-slate-200">
                            {tech.designation || 'Technician'}
                          </p>
                          <p className="text-[10px] text-slate-500 line-clamp-1">
                            {tech.specialization || 'General diagnostics'}
                          </p>
                        </div>
                      </td>

                      {/* Joining Date */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        {tech.joiningDate ? new Date(tech.joiningDate).toLocaleDateString() : '—'}
                      </td>

                      {/* Incentive */}
                      <td className="py-3 px-4">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {tech.incentiveRate}%
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isActive ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link to={`/technicians/${tech.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              title="View full profile & performance"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </Link>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => openEdit(tech)}
                            title="Edit technician details"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            onClick={() => {
                              if (confirm(`Reset password for ${tech.name}? A temporary password will be generated.`)) {
                                resetPasswordMutation.mutate(tech.id)
                              }
                            }}
                            title="Reset password and issue temporary credentials"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-2 text-xs ${
                              isActive
                                ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20'
                                : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                            }`}
                            onClick={() => {
                              const nextStatus = isActive ? 'INACTIVE' : 'ACTIVE'
                              toggleStatusMutation.mutate({ id: tech.id, newStatus: nextStatus })
                            }}
                            title={isActive ? 'Deactivate account' : 'Activate account'}
                          >
                            {isActive ? (
                              <ShieldAlert className="h-3.5 w-3.5" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Technician Dialog */}
      <Dialog
        open={showAddModal}
        onOpenChange={(open) => !open && setShowAddModal(false)}
        title="Add New Technician Account"
        description="Create a login account and profile for a new technician. Credentials can be handed to them immediately."
      >
        <form onSubmit={handleAddSubmit} className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
          {/* Avatar upload */}
          <AvatarUpload
            name={addForm.name || 'New Tech'}
            currentUrl={addForm.profileImageUrl}
            onChange={(url) => setAddForm((f) => ({ ...f, profileImageUrl: url }))}
            label="Profile Image (Optional)"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full Name" htmlFor="add-name">
              <Input
                id="add-name"
                required
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Rahul Sharma"
              />
            </Field>

            <Field label="Unique User ID" htmlFor="add-userid">
              <Input
                id="add-userid"
                required
                value={addForm.userId}
                onChange={(e) => setAddForm((f) => ({ ...f, userId: e.target.value.toUpperCase() }))}
                placeholder="e.g. TECH03"
                className="font-mono uppercase"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email Address" htmlFor="add-email">
              <Input
                id="add-email"
                type="email"
                required
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="rahul@repair.local"
              />
            </Field>

            <Field label="Mobile Number" htmlFor="add-phone">
              <Input
                id="add-phone"
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="9876543210"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Initial Password" htmlFor="add-pass">
              <Input
                id="add-pass"
                type="text"
                required
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Initial password..."
                className="font-mono"
              />
            </Field>

            <Field label="Confirm Password" htmlFor="add-cpass">
              <Input
                id="add-cpass"
                type="text"
                required
                value={addForm.confirmPassword}
                onChange={(e) => setAddForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                placeholder="Re-enter password..."
                className="font-mono"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Designation / Role Title" htmlFor="add-designation">
              <Input
                id="add-designation"
                value={addForm.designation}
                onChange={(e) => setAddForm((f) => ({ ...f, designation: e.target.value }))}
                placeholder="e.g. Smartphone Hardware Specialist"
              />
            </Field>

            <Field label="Joining Date" htmlFor="add-joining">
              <Input
                id="add-joining"
                type="date"
                value={addForm.joiningDate}
                onChange={(e) => setAddForm((f) => ({ ...f, joiningDate: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Specialization / Notes" htmlFor="add-spec">
              <Input
                id="add-spec"
                value={addForm.specialization}
                onChange={(e) => setAddForm((f) => ({ ...f, specialization: e.target.value }))}
                placeholder="e.g. iPhone board repair, displays"
              />
            </Field>

            <Field label="Incentive Rate (%)" htmlFor="add-rate">
              <Input
                id="add-rate"
                type="number"
                min={0}
                max={100}
                value={addForm.incentiveRate}
                onChange={(e) => setAddForm((f) => ({ ...f, incentiveRate: Number(e.target.value) }))}
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Account Status:
            </label>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="add-status"
                  checked={addForm.accountStatus === 'ACTIVE'}
                  onChange={() => setAddForm((f) => ({ ...f, accountStatus: 'ACTIVE' }))}
                />
                <span className="text-emerald-600 font-medium">Active (Can Login)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="add-status"
                  checked={addForm.accountStatus === 'INACTIVE'}
                  onChange={() => setAddForm((f) => ({ ...f, accountStatus: 'INACTIVE' }))}
                />
                <span className="text-rose-600 font-medium">Inactive (Suspended)</span>
              </label>
            </div>
          </div>

          {addError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {addError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Create Technician Account
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit Technician Dialog */}
      <Dialog
        open={Boolean(editingTech)}
        onOpenChange={(open) => !open && setEditingTech(null)}
        title="Edit Technician Account"
        description="Update profile, change login credentials, or adjust account privileges."
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
          <AvatarUpload
            name={editForm.name || 'Technician'}
            currentUrl={editForm.profileImageUrl}
            onChange={(url) => setEditForm((f) => ({ ...f, profileImageUrl: url }))}
            label="Technician Profile Photo"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full Name" htmlFor="edit-name">
              <Input
                id="edit-name"
                required
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>

            <Field label="Unique User ID" htmlFor="edit-userid">
              <Input
                id="edit-userid"
                required
                value={editForm.userId}
                onChange={(e) => setEditForm((f) => ({ ...f, userId: e.target.value.toUpperCase() }))}
                className="font-mono uppercase"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email Address" htmlFor="edit-email">
              <Input
                id="edit-email"
                type="email"
                required
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>

            <Field label="Mobile Number" htmlFor="edit-phone">
              <Input
                id="edit-phone"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Change Password (Optional)" htmlFor="edit-pass">
              <Input
                id="edit-pass"
                type="text"
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to keep current"
                className="font-mono"
              />
            </Field>

            <Field label="Designation" htmlFor="edit-designation">
              <Input
                id="edit-designation"
                value={editForm.designation}
                onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Specialization" htmlFor="edit-spec">
              <Input
                id="edit-spec"
                value={editForm.specialization}
                onChange={(e) => setEditForm((f) => ({ ...f, specialization: e.target.value }))}
              />
            </Field>

            <Field label="Incentive Rate (%)" htmlFor="edit-rate">
              <Input
                id="edit-rate"
                type="number"
                min={0}
                max={100}
                value={editForm.incentiveRate}
                onChange={(e) => setEditForm((f) => ({ ...f, incentiveRate: Number(e.target.value) }))}
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Account Status:
            </label>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="edit-status"
                  checked={editForm.accountStatus === 'ACTIVE'}
                  onChange={() => setEditForm((f) => ({ ...f, accountStatus: 'ACTIVE' }))}
                />
                <span className="text-emerald-600 font-medium">Active</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="edit-status"
                  checked={editForm.accountStatus === 'INACTIVE'}
                  onChange={() => setEditForm((f) => ({ ...f, accountStatus: 'INACTIVE' }))}
                />
                <span className="text-rose-600 font-medium">Inactive (Suspended)</span>
              </label>
            </div>
          </div>

          {editError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {editError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
            <Button type="button" variant="outline" onClick={() => setEditingTech(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              Save Changes
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Generated Credentials / Temporary Password Dialog */}
      <Dialog
        open={tempPasswordModal.open}
        onOpenChange={(open) => !open && setTempPasswordModal((p) => ({ ...p, open: false }))}
        title="Technician Login Credentials"
        description="Share these login credentials with the technician. For security, they will be prompted to set a new password on first sign-in."
      >
        <div className="space-y-4 py-2">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Technician:</span>
              <span className="font-bold text-slate-900 dark:text-white font-sans">
                {tempPasswordModal.techName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">User ID:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                {tempPasswordModal.userId}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Temporary Password:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                {tempPasswordModal.password}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Login Portal:</span>
              <span className="text-slate-600 dark:text-slate-300 font-sans text-[11px]">
                /login?role=technician
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={copyCredentials} className="w-full text-xs">
              {copied ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> Copied to Clipboard!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Credentials
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTempPasswordModal((p) => ({ ...p, open: false }))}
              className="text-xs"
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
